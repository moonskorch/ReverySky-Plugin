using System;
using System.Collections.Generic;
using UnityEngine;

public interface INodeDistanceVisibilityConsumer
{
  /// <summary>
  /// Receives the tracked node identity because some consumers, such as future
  /// graph-level line builders, handle many nodes through one object.
  /// </summary>
  void SetDistanceVisible(Component node, bool visible);
}

/// <summary>
/// Central distance/frustum gate for graph nodes. It uses one CullingGroup for all
/// tracked nodes, while consumers own the visual or behavioral reaction to visibility.
/// </summary>
public sealed class NodeDistanceCullingManager : MonoBehaviour
{
  private const float DefaultDistanceBand = 25f;

  public sealed class Entry
  {
    /// <summary>
    /// Identifies the graph object for shared consumers
    /// </summary>
    public Component node;
    public Transform referenceTransform;
    public INodeDistanceVisibilityConsumer consumer;
    [Min(0.01f)] public float radius = 1f;
    [Min(0.01f)] public float visibleDistance = 25f;
    public bool hasAppliedVisibility;
    public bool lastVisible;
  }

  public static NodeDistanceCullingManager Active { get; private set; }

  [SerializeField] private Camera targetCamera;
  [SerializeField] private bool requireCameraFrustumVisibility = true;
  [SerializeField] private bool refreshBoundsInLateUpdate = true;
  [SerializeField, Min(0f)] private float boundsRefreshInterval = 0f;

  private readonly List<Entry> entries = new();
  private BoundingSphere[] boundingSpheres = Array.Empty<BoundingSphere>();
  private int[] maxVisibleDistanceBandByEntry = Array.Empty<int>();
  private float[] boundingDistances = Array.Empty<float>();
  private CullingGroup cullingGroup;
  private float nextBoundsRefreshTime;

  private void Awake()
  {
    Active = this;
  }

  private void Start()
  {
    Rebuild();

    Cartographer.I.OnGraphVisualsChanged += RebuildFromVisualNodes;
    ICartographerEngine engine = Cartographer.I.ActiveEngine;
    if (engine != null)
      RebuildFromVisualNodes(engine.Stars, engine.TagNodes);
  }

  private void OnDestroy()
  {
    Cartographer.I.OnGraphVisualsChanged -= RebuildFromVisualNodes;
    DisposeCullingGroup();
    if (Active == this)
      Active = null;
  }

  private void LateUpdate()
  {
    if (!refreshBoundsInLateUpdate || entries.Count == 0)
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

    entries.Clear();

    EnsureCullingGroup();
    EnsureSphereCapacity(entries.Count);
    RebuildDistanceBands();
    RefreshBoundingSpheres();
    cullingGroup.SetBoundingSphereCount(entries.Count);

    ApplyCurrentVisibility();
  }

  public void RebuildFromVisualNodes(IReadOnlyList<Star> stars, IReadOnlyList<TagNode> tagNodes)
  {
    DisposeCullingGroup();

    entries.Clear();
    var registeredConsumers = new HashSet<INodeDistanceVisibilityConsumer>();

    // Cartographer owns graph lifecycle, so culling registrations are rebuilt in one batch.
    AddTargetsFromStars(stars, registeredConsumers);
    AddTargetsFromTagNodes(tagNodes, registeredConsumers);

    EnsureCullingGroup();
    EnsureSphereCapacity(entries.Count);
    RebuildDistanceBands();
    RefreshBoundingSpheres();
    cullingGroup.SetBoundingSphereCount(entries.Count);

    ApplyCurrentVisibility();
  }

  public int Register(
    Component node,
    Transform referenceTransform,
    INodeDistanceVisibilityConsumer consumer,
    float radius = 1f,
    float visibleDistance = 25f)
  {
    if (referenceTransform == null || consumer == null)
      return -1;

    EnsureCullingGroup();

    int existingIndex = entries.FindIndex(entry => entry.consumer == consumer);
    if (existingIndex >= 0)
      return existingIndex;

    entries.Add(new Entry
    {
      node = node,
      referenceTransform = referenceTransform,
      consumer = consumer,
      radius = Mathf.Max(0.01f, radius),
      visibleDistance = Mathf.Max(0.01f, visibleDistance)
    });

    int index = entries.Count - 1;
    EnsureSphereCapacity(entries.Count);
    RebuildDistanceBands();
    RefreshBoundingSphere(index);
    cullingGroup.SetBoundingSphereCount(entries.Count);
    return index;
  }

  public void Unregister(INodeDistanceVisibilityConsumer consumer)
  {
    if (consumer == null)
      return;

    int index = entries.FindIndex(entry => entry.consumer == consumer);
    if (index < 0)
      return;

    int lastIndex = entries.Count - 1;
    entries[index] = entries[lastIndex];
    entries.RemoveAt(lastIndex);

    if (index < entries.Count)
      RefreshBoundingSphere(index);

    RebuildDistanceBands();
    cullingGroup?.SetBoundingSphereCount(entries.Count);
  }

  public void RefreshBoundingSpheres()
  {
    for (int i = 0; i < entries.Count; i++)
      RefreshBoundingSphere(i);
  }

  private void RefreshBoundingSphere(int index)
  {
    Entry entry = entries[index];
    boundingSpheres[index] = new BoundingSphere(
      entry.referenceTransform.position,
      Mathf.Max(0.01f, entry.radius));
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
    Array.Resize(ref maxVisibleDistanceBandByEntry, newSize);
    cullingGroup?.SetBoundingSpheres(boundingSpheres);
  }

  private void RebuildDistanceBands()
  {
    if (entries.Count == 0)
    {
      boundingDistances = new[] { DefaultDistanceBand };
      cullingGroup?.SetBoundingDistances(boundingDistances);
      return;
    }

    // CullingGroup uses one shared sorted distance set; each entry maps its own threshold back to a band.
    List<float> distances = new();
    for (int i = 0; i < entries.Count; i++)
      AddUniqueDistance(distances, Mathf.Max(0.01f, entries[i].visibleDistance));

    distances.Sort();
    boundingDistances = distances.ToArray();
    cullingGroup?.SetBoundingDistances(boundingDistances);

    for (int i = 0; i < entries.Count; i++)
      maxVisibleDistanceBandByEntry[i] = ResolveDistanceBand(entries[i].visibleDistance);
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
    ApplyVisibilityIfChanged(state.index, ResolveVisibility(state.index, state.isVisible, state.currentDistance));
  }

  private void ApplyCurrentVisibility()
  {
    if (cullingGroup == null)
      return;

    for (int i = 0; i < entries.Count; i++)
      ApplyVisibilityIfChanged(i, ResolveVisibility(i, cullingGroup.IsVisible(i), cullingGroup.GetDistance(i)));
  }

  private bool ResolveVisibility(int index, bool isVisibleToCamera, int distanceBand)
  {
    bool isNearEnough =
      index >= 0 &&
      index < maxVisibleDistanceBandByEntry.Length &&
      distanceBand <= maxVisibleDistanceBandByEntry[index];

    return isNearEnough && (!requireCameraFrustumVisibility || isVisibleToCamera);
  }

  private void ApplyVisibilityIfChanged(int index, bool visible)
  {
    if (index < 0 || index >= entries.Count)
      return;

    Entry entry = entries[index];
    if (entry.hasAppliedVisibility && entry.lastVisible == visible)
      return;

    // Consumers only receive the initial state and real threshold transitions, not every camera update.
    entry.hasAppliedVisibility = true;
    entry.lastVisible = visible;
    entry.consumer?.SetDistanceVisible(entry.node, visible);
  }

  private static bool IsUsable(Entry entry)
  {
    return entry != null && entry.referenceTransform != null && entry.consumer != null;
  }

  private void AddTargetsFromStars(IReadOnlyList<Star> stars, HashSet<INodeDistanceVisibilityConsumer> registeredConsumers)
  {
    if (stars == null)
      return;

    for (int i = 0; i < stars.Count; i++)
      AddTargetFromComponent(stars[i], registeredConsumers);
  }

  private void AddTargetsFromTagNodes(IReadOnlyList<TagNode> tagNodes, HashSet<INodeDistanceVisibilityConsumer> registeredConsumers)
  {
    if (tagNodes == null)
      return;

    for (int i = 0; i < tagNodes.Count; i++)
      AddTargetFromComponent(tagNodes[i], registeredConsumers);
  }

  private void AddTargetFromComponent(Component component, HashSet<INodeDistanceVisibilityConsumer> registeredConsumers)
  {
    if (component == null)
      return;

    // Label targets are the first consumer type; the manager still only stores distance data.
    NodeLabelCullingTarget target = component.GetComponent<NodeLabelCullingTarget>();
    if (target != null && target.TryCreateDistanceEntry(out var entry))
      AddEntry(entry, registeredConsumers);
  }

  private void AddEntry(Entry entry, HashSet<INodeDistanceVisibilityConsumer> registeredConsumers)
  {
    if (!IsUsable(entry) || !registeredConsumers.Add(entry.consumer))
      return;

    entries.Add(entry);
  }

  private void DisposeCullingGroup()
  {
    if (cullingGroup == null)
      return;

    cullingGroup.Dispose();
    cullingGroup = null;
  }
}
