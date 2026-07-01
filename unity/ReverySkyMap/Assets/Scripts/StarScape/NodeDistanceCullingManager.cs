using System;
using System.Collections.Generic;
using UnityEngine;

public interface INodeDistanceCullingConsumer
{
  /// <summary>
  /// Describes one distance rule requested by this consumer for the supplied graph node.
  /// The manager may merge this request with other consumers on the same physical node.
  /// </summary>
  bool TryCreateDistanceEntry(Component node, out NodeDistanceCullingManager.Entry entry);

  /// <summary>
  /// Receives the tracked node identity because some consumers, such as future
  /// graph-level line builders, may handle many nodes through one object.
  /// </summary>
  void SetDistanceVisible(Component node, bool visible);
}

/// <summary>
/// Central distance/frustum gate for graph nodes.
/// It tracks each physical node once, then applies that node's distance state to
/// all consumer-specific interests attached to it.
/// </summary>
public sealed class NodeDistanceCullingManager : MonoBehaviour
{
  private const float DefaultDistanceBand = 25f;

  /// <summary>
  /// Consumer request DTO. It is folded into a runtime NodeTarget/Interest pair;
  /// it is not stored as the manager's main tracking unit.
  /// </summary>
  public sealed class Entry
  {
    /// <summary>
    /// Identifies the graph object for shared consumers
    /// </summary>
    public Component node;
    public Transform referenceTransform;
    public INodeDistanceCullingConsumer consumer;
    [Min(0.01f)] public float radius = 1f;
    [Min(0.01f)] public float visibleDistance = 25f;
  }

  /// <summary>
  /// Runtime culling unit: one physical graph node, one transform, one sphere.
  /// Multiple consumers on the same node are stored as interests below this target.
  /// </summary>
  private sealed class NodeTarget
  {
    public Component node;
    public Transform referenceTransform;
    public float radius;
    public readonly List<Interest> interests = new();
  }

  /// <summary>
  /// Per-consumer distance rule and transition state.
  /// Different interests under one NodeTarget can use different visible distances.
  /// </summary>
  private sealed class Interest
  {
    public INodeDistanceCullingConsumer consumer;
    public float visibleDistance;
    public int maxVisibleDistanceBand;
    public bool hasAppliedVisibility;
    public bool lastVisible;
  }

  public static NodeDistanceCullingManager Active { get; private set; }

  [SerializeField] private Camera targetCamera;
  [SerializeField] private bool requireCameraFrustumVisibility = true;
  [SerializeField] private bool refreshBoundsInLateUpdate = true;
  [SerializeField, Min(0f)] private float boundsRefreshInterval = 0f;

  private readonly List<NodeTarget> nodeTargets = new();
  // Scratch list reused during batch rebuilds to avoid per-node GetComponents allocations.
  private readonly List<MonoBehaviour> componentBuffer = new();
  private BoundingSphere[] boundingSpheres = Array.Empty<BoundingSphere>();
  private float[] boundingDistances = Array.Empty<float>();
  private CullingGroup cullingGroup;
  private float nextBoundsRefreshTime;

  private void Awake()
  {
    Active = this;
  }

  private void OnDestroy()
  {
    DisposeCullingGroup();
    if (Active == this)
      Active = null;
  }

  private void LateUpdate()
  {
    if (!refreshBoundsInLateUpdate || nodeTargets.Count == 0)
      return;

    if (Time.unscaledTime < nextBoundsRefreshTime)
      return;

    RefreshBoundingSpheres();
    ApplyCurrentVisibility();
    nextBoundsRefreshTime = Time.unscaledTime + boundsRefreshInterval;
  }

  public void Rebuild()
  {
    DisposeCullingGroup();

    nodeTargets.Clear();

    EnsureCullingGroup();
    EnsureSphereCapacity(nodeTargets.Count);
    RebuildDistanceBands();
    RefreshBoundingSpheres();
    cullingGroup.SetBoundingSphereCount(nodeTargets.Count);

    ApplyCurrentVisibility();
  }

  public void RebuildFromVisualNodes(IReadOnlyList<Star> stars, IReadOnlyList<TagNode> tagNodes)
  {
    RebuildFromVisualNodes(stars, tagNodes, null);
  }

  public void RebuildFromVisualNodes(
    IReadOnlyList<Star> stars,
    IReadOnlyList<TagNode> tagNodes,
    INodeDistanceCullingConsumer extraConsumer)
  {
    DisposeCullingGroup();

    nodeTargets.Clear();

    // Cartographer owns graph lifecycle, so culling registrations are rebuilt in one batch.
    AddTargetsFromStars(stars, extraConsumer);
    AddTargetsFromTagNodes(tagNodes, extraConsumer);

    EnsureCullingGroup();
    EnsureSphereCapacity(nodeTargets.Count);
    RebuildDistanceBands();
    RefreshBoundingSpheres();
    cullingGroup.SetBoundingSphereCount(nodeTargets.Count);

    ApplyCurrentVisibility();
  }

  public int Register(
    Component node,
    Transform referenceTransform,
    INodeDistanceCullingConsumer consumer,
    float radius = 1f,
    float visibleDistance = 25f)
  {
    if (referenceTransform == null || consumer == null)
      return -1;

    EnsureCullingGroup();

    int existingIndex = FindConsumerTargetIndex(node, referenceTransform, consumer);
    if (existingIndex >= 0)
      return existingIndex;

    int index = AddEntry(new Entry
    {
      node = node,
      referenceTransform = referenceTransform,
      consumer = consumer,
      radius = Mathf.Max(0.01f, radius),
      visibleDistance = Mathf.Max(0.01f, visibleDistance)
    });

    EnsureSphereCapacity(nodeTargets.Count);
    RebuildDistanceBands();
    RefreshBoundingSphere(index);
    cullingGroup.SetBoundingSphereCount(nodeTargets.Count);
    return index;
  }

  public void Unregister(INodeDistanceCullingConsumer consumer)
  {
    if (consumer == null)
      return;

    for (int targetIndex = nodeTargets.Count - 1; targetIndex >= 0; targetIndex--)
    {
      NodeTarget target = nodeTargets[targetIndex];
      target.interests.RemoveAll(interest => interest.consumer == consumer);

      if (target.interests.Count == 0)
      {
        int lastIndex = nodeTargets.Count - 1;
        nodeTargets[targetIndex] = nodeTargets[lastIndex];
        nodeTargets.RemoveAt(lastIndex);
      }
      else
      {
        RefreshBoundingSphere(targetIndex);
      }
    }

    RebuildDistanceBands();
    cullingGroup?.SetBoundingSphereCount(nodeTargets.Count);
  }

  public void RefreshBoundingSpheres()
  {
    for (int i = 0; i < nodeTargets.Count; i++)
      RefreshBoundingSphere(i);
  }

  private void RefreshBoundingSphere(int index)
  {
    NodeTarget target = nodeTargets[index];
    boundingSpheres[index] = new BoundingSphere(
      target.referenceTransform.position,
      Mathf.Max(0.01f, target.radius));
  }

  private void EnsureCullingGroup()
  {
    if (cullingGroup != null)
      return;

    Camera camera = ResolveTargetCamera();
    cullingGroup = new CullingGroup
    {
      targetCamera = camera,
      onStateChanged = OnCullingStateChanged
    };

    if (camera != null)
      cullingGroup.SetDistanceReferencePoint(camera.transform);

    cullingGroup.SetBoundingDistances(new[] { DefaultDistanceBand });
    cullingGroup.SetBoundingSpheres(boundingSpheres);
    cullingGroup.SetBoundingSphereCount(0);
  }

  private Camera ResolveTargetCamera()
  {
    if (targetCamera != null)
      return targetCamera;

    targetCamera = Camera.main;
    return targetCamera;
  }

  private void EnsureSphereCapacity(int count)
  {
    if (boundingSpheres.Length >= count)
      return;

    int newSize = Mathf.NextPowerOfTwo(Mathf.Max(1, count));
    Array.Resize(ref boundingSpheres, newSize);
    cullingGroup?.SetBoundingSpheres(boundingSpheres);
  }

  private void RebuildDistanceBands()
  {
    if (nodeTargets.Count == 0)
    {
      boundingDistances = new[] { DefaultDistanceBand };
      cullingGroup?.SetBoundingDistances(boundingDistances);
      return;
    }

    // CullingGroup exposes one shared sorted distance-band table for all spheres.
    // Interests keep their own max band so one tracked sphere can drive several thresholds.
    List<float> distances = new();
    for (int i = 0; i < nodeTargets.Count; i++)
    {
      List<Interest> interests = nodeTargets[i].interests;
      for (int j = 0; j < interests.Count; j++)
        AddUniqueDistance(distances, Mathf.Max(0.01f, interests[j].visibleDistance));
    }

    if (distances.Count == 0)
      distances.Add(DefaultDistanceBand);

    distances.Sort();
    boundingDistances = distances.ToArray();
    cullingGroup?.SetBoundingDistances(boundingDistances);

    for (int i = 0; i < nodeTargets.Count; i++)
    {
      List<Interest> interests = nodeTargets[i].interests;
      for (int j = 0; j < interests.Count; j++)
        interests[j].maxVisibleDistanceBand = ResolveDistanceBand(interests[j].visibleDistance);
    }
  }

  private static void AddUniqueDistance(List<float> distances, float distance)
  {
    for (int i = 0; i < distances.Count; i++)
    {
      if (Mathf.Approximately(distances[i], distance))
        return;
    }

    distances.Add(distance);
  }

  private int ResolveDistanceBand(float visibleDistance)
  {
    for (int i = 0; i < boundingDistances.Length; i++)
    {
      if (visibleDistance <= boundingDistances[i] || Mathf.Approximately(visibleDistance, boundingDistances[i]))
        return i;
    }

    return Mathf.Max(0, boundingDistances.Length - 1);
  }

  private void OnCullingStateChanged(CullingGroupEvent state)
  {
    ApplyTargetVisibility(state.index, state.isVisible, state.currentDistance);
  }

  private void ApplyCurrentVisibility()
  {
    if (cullingGroup == null)
      return;

    for (int i = 0; i < nodeTargets.Count; i++)
      ApplyTargetVisibility(i, cullingGroup.IsVisible(i), cullingGroup.GetDistance(i));
  }

  private bool ResolveVisibility(bool isVisibleToCamera, int distanceBand, Interest interest)
  {
    bool isNearEnough = interest != null && distanceBand <= interest.maxVisibleDistanceBand;

    return isNearEnough && (!requireCameraFrustumVisibility || isVisibleToCamera);
  }

  private void ApplyTargetVisibility(int index, bool isVisibleToCamera, int distanceBand)
  {
    if (index < 0 || index >= nodeTargets.Count)
      return;

    // The CullingGroup result belongs to the physical node; each interest decides
    // whether that same band crosses its own consumer-specific threshold.
    NodeTarget target = nodeTargets[index];
    for (int i = 0; i < target.interests.Count; i++)
    {
      Interest interest = target.interests[i];
      ApplyInterestVisibilityIfChanged(target, interest, ResolveVisibility(isVisibleToCamera, distanceBand, interest));
    }
  }

  private void ApplyVisibilityIfChanged(int index, bool visible)
  {
    if (index < 0 || index >= nodeTargets.Count)
      return;

    NodeTarget target = nodeTargets[index];
    for (int i = 0; i < target.interests.Count; i++)
      ApplyInterestVisibilityIfChanged(target, target.interests[i], visible);
  }

  private static void ApplyInterestVisibilityIfChanged(NodeTarget target, Interest interest, bool visible)
  {
    if (interest == null)
      return;

    // Consumers only receive the initial state and real threshold transitions, not every camera update.
    if (interest.hasAppliedVisibility && interest.lastVisible == visible)
      return;

    interest.hasAppliedVisibility = true;
    interest.lastVisible = visible;
    interest.consumer?.SetDistanceVisible(target.node, visible);
  }

  private static bool IsUsable(Entry entry)
  {
    return entry != null && entry.referenceTransform != null && entry.consumer != null;
  }

  private int FindConsumerTargetIndex(
    Component node,
    Transform referenceTransform,
    INodeDistanceCullingConsumer consumer)
  {
    int targetIndex = FindNodeTargetIndex(node, referenceTransform);
    if (targetIndex < 0)
      return -1;

    List<Interest> interests = nodeTargets[targetIndex].interests;
    for (int i = 0; i < interests.Count; i++)
    {
      if (interests[i].consumer == consumer)
        return targetIndex;
    }

    return -1;
  }

  private static bool HasInterest(NodeTarget target, INodeDistanceCullingConsumer consumer)
  {
    List<Interest> interests = target.interests;
    for (int i = 0; i < interests.Count; i++)
    {
      if (interests[i].consumer == consumer)
        return true;
    }

    return false;
  }

  private int FindNodeTargetIndex(Component node, Transform referenceTransform)
  {
    for (int i = 0; i < nodeTargets.Count; i++)
    {
      NodeTarget target = nodeTargets[i];
      if (node != null && target.node == node)
        return i;

      if (node == null && target.referenceTransform == referenceTransform)
        return i;
    }

    return -1;
  }

  private void AddTargetsFromStars(
    IReadOnlyList<Star> stars,
    INodeDistanceCullingConsumer extraConsumer)
  {
    if (stars == null)
      return;

    for (int i = 0; i < stars.Count; i++)
      AddTargetFromComponent(stars[i], extraConsumer);
  }

  private void AddTargetsFromTagNodes(
    IReadOnlyList<TagNode> tagNodes,
    INodeDistanceCullingConsumer extraConsumer)
  {
    if (tagNodes == null)
      return;

    for (int i = 0; i < tagNodes.Count; i++)
      AddTargetFromComponent(tagNodes[i], extraConsumer);
  }

  private void AddTargetFromComponent(
    Component component,
    INodeDistanceCullingConsumer extraConsumer)
  {
    if (component == null)
      return;

    // Cartographer gives physical graph nodes; target components on those nodes declare distance interests.
    componentBuffer.Clear();
    component.GetComponents(componentBuffer);
    for (int i = 0; i < componentBuffer.Count; i++)
    {
      if (componentBuffer[i] is INodeDistanceCullingConsumer consumer &&
          consumer.TryCreateDistanceEntry(component, out var entry))
        AddEntry(entry);
    }

    if (extraConsumer != null &&
        extraConsumer.TryCreateDistanceEntry(component, out var extraEntry))
    {
      AddEntry(extraEntry);
    }
  }

  private int AddEntry(Entry entry)
  {
    if (!IsUsable(entry))
      return -1;

    // Many consumers can request distance state for the same physical node.
    // They share one NodeTarget/sphere and differ only by Interest data.
    int targetIndex = FindNodeTargetIndex(entry.node, entry.referenceTransform);
    if (targetIndex < 0)
    {
      nodeTargets.Add(new NodeTarget
      {
        node = entry.node,
        referenceTransform = entry.referenceTransform,
        radius = Mathf.Max(0.01f, entry.radius)
      });

      targetIndex = nodeTargets.Count - 1;
    }

    NodeTarget target = nodeTargets[targetIndex];
    if (HasInterest(target, entry.consumer))
      return targetIndex;

    target.radius = Mathf.Max(target.radius, Mathf.Max(0.01f, entry.radius));
    target.interests.Add(new Interest
    {
      consumer = entry.consumer,
      visibleDistance = Mathf.Max(0.01f, entry.visibleDistance)
    });

    return targetIndex;
  }

  private void DisposeCullingGroup()
  {
    if (cullingGroup == null)
      return;

    cullingGroup.Dispose();
    cullingGroup = null;
  }
}
