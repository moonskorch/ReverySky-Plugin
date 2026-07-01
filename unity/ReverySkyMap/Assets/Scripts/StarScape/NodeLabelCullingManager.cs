using System;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Central distance/frustum gate for node labels. It uses one CullingGroup for all
/// registered nodes and hides each label root GameObject, so TMP fallback renderers
/// created for non-Latin text are culled together with the visible label.
/// </summary>
public sealed class NodeLabelCullingManager : MonoBehaviour
{
  private const float DefaultDistanceBand = 25f;

  [Serializable]
  public sealed class Entry
  {
    public Transform referenceTransform;
    public GameObject labelRoot;
    public Behaviour[] behavioursWhenVisible;
    [Min(0.01f)] public float radius = 1f;
    [Min(0.01f)] public float visibleDistance = 25f;
  }

  public static NodeLabelCullingManager Active { get; private set; }

  [SerializeField] private Camera targetCamera;
  [SerializeField] private bool requireCameraFrustumVisibility = true;
  [SerializeField] private bool refreshBoundsInLateUpdate = true;
  [SerializeField, Min(0f)] private float boundsRefreshInterval = 0f;
  [SerializeField] private List<Entry> sceneEntries = new();

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
    var registeredLabelRoots = new HashSet<GameObject>();
    for (int i = 0; i < sceneEntries.Count; i++)
    {
      if (IsUsable(sceneEntries[i]))
        AddEntry(sceneEntries[i], registeredLabelRoots);
    }

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
    var registeredLabelRoots = new HashSet<GameObject>();
    for (int i = 0; i < sceneEntries.Count; i++)
    {
      if (IsUsable(sceneEntries[i]))
        AddEntry(sceneEntries[i], registeredLabelRoots);
    }

    AddTargetsFromStars(stars, registeredLabelRoots);
    AddTargetsFromTagNodes(tagNodes, registeredLabelRoots);

    EnsureCullingGroup();
    EnsureSphereCapacity(entries.Count);
    RebuildDistanceBands();
    RefreshBoundingSpheres();
    cullingGroup.SetBoundingSphereCount(entries.Count);

    ApplyCurrentVisibility();
  }

  public int Register(
    Transform referenceTransform,
    GameObject labelRoot,
    Behaviour[] behavioursWhenVisible = null,
    float radius = 1f,
    float visibleDistance = 25f)
  {
    if (referenceTransform == null || labelRoot == null)
      return -1;

    EnsureCullingGroup();

    int existingIndex = entries.FindIndex(entry => entry.labelRoot == labelRoot);
    if (existingIndex >= 0)
      return existingIndex;

    entries.Add(new Entry
    {
      referenceTransform = referenceTransform,
      labelRoot = labelRoot,
      behavioursWhenVisible = behavioursWhenVisible,
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

  public void Unregister(GameObject labelRoot)
  {
    if (labelRoot == null)
      return;

    int index = entries.FindIndex(entry => entry.labelRoot == labelRoot);
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
    ApplyVisibility(state.index, ShouldShowLabel(state.index, state.isVisible, state.currentDistance));
  }

  private void ApplyCurrentVisibility()
  {
    if (cullingGroup == null)
      return;

    for (int i = 0; i < entries.Count; i++)
      ApplyVisibility(i, ShouldShowLabel(i, cullingGroup.IsVisible(i), cullingGroup.GetDistance(i)));
  }

  private bool ShouldShowLabel(int index, bool isVisibleToCamera, int distanceBand)
  {
    bool isNearEnough =
      index >= 0 &&
      index < maxVisibleDistanceBandByEntry.Length &&
      distanceBand <= maxVisibleDistanceBandByEntry[index];

    return isNearEnough && (!requireCameraFrustumVisibility || isVisibleToCamera);
  }

  private void ApplyVisibility(int index, bool visible)
  {
    if (index < 0 || index >= entries.Count)
      return;

    Entry entry = entries[index];
    if (entry.labelRoot != null && entry.labelRoot.activeSelf != visible)
      entry.labelRoot.SetActive(visible);

    if (entry.behavioursWhenVisible == null)
      return;

    for (int i = 0; i < entry.behavioursWhenVisible.Length; i++)
    {
      Behaviour behaviour = entry.behavioursWhenVisible[i];
      if (behaviour != null)
        behaviour.enabled = visible;
    }
  }

  private static bool IsUsable(Entry entry)
  {
    return entry != null && entry.referenceTransform != null && entry.labelRoot != null;
  }

  private void AddTargetsFromStars(IReadOnlyList<Star> stars, HashSet<GameObject> registeredLabelRoots)
  {
    if (stars == null)
      return;

    for (int i = 0; i < stars.Count; i++)
      AddTargetFromComponent(stars[i], registeredLabelRoots);
  }

  private void AddTargetsFromTagNodes(IReadOnlyList<TagNode> tagNodes, HashSet<GameObject> registeredLabelRoots)
  {
    if (tagNodes == null)
      return;

    for (int i = 0; i < tagNodes.Count; i++)
      AddTargetFromComponent(tagNodes[i], registeredLabelRoots);
  }

  private void AddTargetFromComponent(Component component, HashSet<GameObject> registeredLabelRoots)
  {
    if (component == null)
      return;

    NodeLabelCullingTarget target = component.GetComponent<NodeLabelCullingTarget>();
    if (target != null && target.TryCreateEntry(out var entry))
      AddEntry(entry, registeredLabelRoots);
  }

  private void AddEntry(Entry entry, HashSet<GameObject> registeredLabelRoots)
  {
    if (!IsUsable(entry) || !registeredLabelRoots.Add(entry.labelRoot))
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
