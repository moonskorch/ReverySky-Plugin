using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using UnityEngine;

/// <summary>
/// The visual result resembles Force: evenly distributed nodes inside a sphere.
/// At larger scales, however, this shape is less informative and less interesting than RecursiveHubs.
/// Compared with Barnes, it also looks better visually.
/// At 10K, the space becomes completely crowded, even though the spheres do not touch directly - everything is wrapped in glow.
/// At 2K, FPS is 8-9.
/// At 10K, FPS is 2-3.
/// [Cartographer] Graph built in 543,7 ms (notes=2000, engine=StaticLinks)
/// [Cartographer] Graph built in 3328,9 ms (notes=10000, engine=StaticLinks)
/// Overall: it may be the best Force-like engine, but it is worse than RecursiveHubs both visually and in performance.
/// </summary>


// Evaluation target:
// - Test a third direction between Engine_EmptySpheres and settled-force engines.
// - Preserve force-like global structure without all-node repulsion.
// - Use a bounded set of structural landmarks as a coarse stress embedding,
//   then refine only real graph edges plus local spatial-hash separation.
// - Intended first test matrix: Normal/Hub/Clusters/Tagless at 500 and 1500 notes.
// Assessment:
// - Pending manual evaluation.

/// <summary>
/// Static landmark-stress layout for medium and large note graphs.
///
/// The engine selects a small number of structurally important landmarks,
/// propagates graph proximity from those landmarks, places every node from
/// weighted landmark influence, and then performs bounded edge-only relaxation.
/// It intentionally avoids global all-node repulsion and per-frame motion.
/// </summary>
[DisallowMultipleComponent]
public class Engine_LandmarkStress_v1 : MonoBehaviour, ICartographerEngine
{
  [Header("Prefabs & Parents")]
  [SerializeField] private StarSO starTemplate;
  [SerializeField] private Transform layoutParent;
  [SerializeField] private TagNodeSO tagNodeTemplate;
  [SerializeField] private LineRenderer edgePrefab;

  [Header("Spatial scale")]
  [SerializeField, Min(0.1f)] private float nodeSpacingFactor = 6.4f;
  [SerializeField, Min(0.1f)] private float minimumBoundRadius = 10f;
  [SerializeField, Range(0.05f, 0.95f)] private float componentSpreadRatio = 0.78f;
  [SerializeField, Range(0.2f, 2.5f)] private float componentRadiusFactor = 1.16f;
  [SerializeField, Min(0.1f)] private float minimumNodeDistance = 2.45f;

  [Header("Landmarks")]
  [SerializeField, Range(1, 128)] private int maxLandmarks = 48;
  [SerializeField, Range(1, 32)] private int maxLandmarksPerComponent = 10;
  [SerializeField, Range(0.1f, 3f)] private float landmarkCountFactor = 0.9f;
  [SerializeField, Range(0, 5)] private int landmarkExclusionGraphDepth = 1;
  [SerializeField, Range(0.05f, 0.98f)] private float landmarkSpreadRatio = 0.72f;
  [SerializeField, Range(1, 8)] private int landmarkPropagationDepth = 4;
  [SerializeField, Range(1, 16)] private int maxLandmarkInfluencesPerNode = 5;
  [SerializeField, Range(0.25f, 4f)] private float landmarkProximityPower = 1.35f;
  [SerializeField] private bool preferNotesAsLandmarks = true;

  [Header("Structural score")]
  [SerializeField, Min(0f)] private float directLinkScoreWeight = 2.5f;
  [SerializeField, Min(0f)] private float noteTagScoreWeight = 0.55f;
  [SerializeField, Min(0f)] private float degreeScoreBonus = 0.55f;
  [SerializeField, Min(0f)] private float tagNodeScoreMultiplier = 1.2f;
  [SerializeField, Min(0.1f)] private float maximumTagHubScore = 6f;

  [Header("Stress refinement")]
  [SerializeField, Range(0, 48)] private int linkRelaxationPasses = 8;
  [SerializeField, Range(0f, 1f)] private float linkPull = 0.12f;
  [SerializeField, Min(0.01f)] private float maxMovePerPass = 0.72f;
  [SerializeField, Min(0.01f)] private float noteTagRestLength = 7.2f;
  [SerializeField, Min(0.01f)] private float directLinkRestLength = 6.8f;
  [SerializeField, Min(0.01f)] private float minimumDirectLinkRestLength = 3.0f;
  [SerializeField, Range(0f, 1f)] private float landmarkMobility = 0.22f;

  [Header("Residual separation")]
  [SerializeField, Range(0, 16)] private int separationPasses = 2;
  [SerializeField, Range(8, 8192)] private int maxSeparationChecksPerNode = 128;

  [Header("Visual")]
  [SerializeField, Min(0.01f)] private float tagScale = 0.7f;
  [SerializeField, Min(0)] private int maxVisibleEdges = 1500;
  [SerializeField, Range(0f, 1f)] private float directLinkBudgetRatio = 0.58f;
  [SerializeField, Min(1f)] private float maxVisibleTagEdgeRestMultiplier = 2.8f;

  private const float GOLDEN_ANGLE_RAD = 2.39996323f;
  private const float GOLDEN_RATIO_CONJUGATE = 0.61803398875f;
  private const float MIN_SQR_DISTANCE = 0.000001f;

  private float _boundRadius;
  private int _noteCount;
  private int _landmarkCount;
  private long _separationPairChecks;

  private readonly List<Node> _nodes = new();
  private readonly List<Edge> _tagEdges = new();
  private readonly List<Edge> _noteLinks = new();
  private readonly List<Edge> _allEdges = new();
  private readonly List<Component> _components = new();
  private readonly List<int> _landmarkNodeIndices = new();
  private readonly List<LineRenderer> _lines = new();
  private readonly List<Star> _stars = new();

  private List<Neighbor>[] _adjacency = Array.Empty<List<Neighbor>>();
  private List<LandmarkInfluence>[] _landmarkInfluences = Array.Empty<List<LandmarkInfluence>>();
  private Vector3[] _corrections = Array.Empty<Vector3>();
  private int[] _correctionCounts = Array.Empty<int>();

  private readonly Dictionary<Vector3Int, List<int>> _separationGrid = new();
  private readonly List<List<int>> _separationBucketPool = new();
  private int _usedSeparationBuckets;

  private sealed class Node
  {
    public bool IsNote;
    public NoteData Note;
    public int TagId;
    public int TagFrequency;
    public string Key;

    public float StructuralScore;
    public Vector3 LocalPosition;
    public int ComponentIndex = -1;
    public int OrderInComponent;
    public bool IsLandmark;
    public int LandmarkOffset = -1;

    public Star Star;
    public TagNode TagNode;

    public Transform VisualTransform
    {
      get
      {
        if (Star != null) return Star.transform;
        if (TagNode != null) return TagNode.transform;
        return null;
      }
    }
  }

  private enum EdgeKind
  {
    NoteTag,
    DirectNoteLink
  }

  private readonly struct Edge
  {
    public readonly int A;
    public readonly int B;
    public readonly float Weight;
    public readonly EdgeKind Kind;

    public Edge(int a, int b, float weight, EdgeKind kind)
    {
      A = a;
      B = b;
      Weight = weight;
      Kind = kind;
    }
  }

  private readonly struct Neighbor
  {
    public readonly int NodeIndex;
    public readonly float Weight;
    public readonly EdgeKind Kind;

    public Neighbor(int nodeIndex, float weight, EdgeKind kind)
    {
      NodeIndex = nodeIndex;
      Weight = weight;
      Kind = kind;
    }
  }

  private sealed class Component
  {
    public readonly List<int> Nodes = new();
    public readonly List<int> Landmarks = new();
    public string Key;
    public Vector3 Center;
    public float Radius;
  }

  private readonly struct LandmarkInfluence
  {
    public readonly int LandmarkNodeIndex;
    public readonly float Weight;

    public LandmarkInfluence(int landmarkNodeIndex, float weight)
    {
      LandmarkNodeIndex = landmarkNodeIndex;
      Weight = weight;
    }
  }

  public CartographerEngine EngineType => CartographerEngine.StaticLinks;
  public bool RequiresTick => false;
  public float BoundRadius => _boundRadius;
  public Vector3 Pivot => layoutParent ? layoutParent.position : transform.position;
  public ScapeCameraWarper ScapeWarper => null;
  public IReadOnlyList<Star> Stars => _stars;

  private void Awake()
  {
    _boundRadius = CalculateBoundRadius(0, nodeSpacingFactor, minimumBoundRadius);
  }

  public void Tick(float dt)
  {
    // The landmark-stress layout is intentionally frozen after BuildGraph().
  }

  public void BuildGraph(List<NoteData> notes)
  {
    var totalStopwatch = Stopwatch.StartNew();

    var clearStopwatch = Stopwatch.StartNew();
    ClearGraph();
    clearStopwatch.Stop();

    var logicalStopwatch = Stopwatch.StartNew();
    BuildLogicalGraph(notes);
    BuildAdjacencyAndScores();
    FindConnectedComponents();
    CalculateComponentGeometry();
    logicalStopwatch.Stop();

    if (_noteCount == 0)
    {
      totalStopwatch.Stop();
      UnityEngine.Debug.Log(
        $"[LandmarkStress] Built empty graph in {totalStopwatch.Elapsed.TotalMilliseconds:F1} ms. " +
        $"ClearGraphMs={clearStopwatch.Elapsed.TotalMilliseconds:F1}, LogicalMs={logicalStopwatch.Elapsed.TotalMilliseconds:F1}");
      return;
    }

    var landmarkStopwatch = Stopwatch.StartNew();
    SelectAndPlaceLandmarks();
    PropagateLandmarkInfluences();
    PlaceNodesFromLandmarks();
    landmarkStopwatch.Stop();

    var relaxationStopwatch = Stopwatch.StartNew();
    RelaxLinkedStress();
    ResolveResidualSeparation();
    relaxationStopwatch.Stop();

    var instantiateNodesStopwatch = Stopwatch.StartNew();
    InstantiateNodes();
    instantiateNodesStopwatch.Stop();

    var instantiateLinesStopwatch = Stopwatch.StartNew();
    InstantiateLines();
    instantiateLinesStopwatch.Stop();

    totalStopwatch.Stop();

    UnityEngine.Debug.Log(
      $"[LandmarkStress] Built notes={_noteCount}, tags={_nodes.Count - _noteCount}, " +
      $"tagEdges={_tagEdges.Count}, noteLinks={_noteLinks.Count}, components={_components.Count}, " +
      $"landmarks={_landmarkCount}, separationChecks={_separationPairChecks}, visibleEdges={_lines.Count}, " +
      $"boundRadius={_boundRadius:F1}, totalMs={totalStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"ClearGraphMs={clearStopwatch.Elapsed.TotalMilliseconds:F1}, LogicalMs={logicalStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"LandmarkMs={landmarkStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"RelaxationMs={relaxationStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"InstantiateNodesMs={instantiateNodesStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"InstantiateLinesMs={instantiateLinesStopwatch.Elapsed.TotalMilliseconds:F1}");
  }

  public void ClearGraph()
  {
    for (int i = 0; i < _lines.Count; i++)
      if (_lines[i]) Destroy(_lines[i].gameObject);
    _lines.Clear();

    for (int i = 0; i < _nodes.Count; i++)
    {
      var visualTransform = _nodes[i].VisualTransform;
      if (visualTransform) Destroy(visualTransform.gameObject);
    }

    _nodes.Clear();
    _tagEdges.Clear();
    _noteLinks.Clear();
    _allEdges.Clear();
    _components.Clear();
    _landmarkNodeIndices.Clear();
    _stars.Clear();

    _adjacency = Array.Empty<List<Neighbor>>();
    _landmarkInfluences = Array.Empty<List<LandmarkInfluence>>();
    _corrections = Array.Empty<Vector3>();
    _correctionCounts = Array.Empty<int>();

    _noteCount = 0;
    _landmarkCount = 0;
    _separationPairChecks = 0;
    _boundRadius = CalculateBoundRadius(0, nodeSpacingFactor, minimumBoundRadius);

    ResetSeparationGrid();
  }

  public void ApplyView(ScapeView view)
  {
    bool showDetails = view == ScapeView.Planets;

    for (int i = 0; i < _nodes.Count; i++)
    {
      var node = _nodes[i];
      if (node.TagNode != null)
        node.TagNode.gameObject.SetActive(showDetails);
      if (node.Star != null)
        node.Star.SetView(view);
    }

    for (int i = 0; i < _lines.Count; i++)
      if (_lines[i] != null) _lines[i].enabled = showDetails;
  }

  public Star FindStarByNoteId(string noteId)
  {
    if (string.IsNullOrEmpty(noteId)) return null;

    for (int i = 0; i < _stars.Count; i++)
    {
      var star = _stars[i];
      if (star != null && star.Data != null && star.Data.Id == noteId)
        return star;
    }

    return null;
  }

  public static float CalculateBoundRadius(
    int totalNodeCount,
    float spacingFactor,
    float minimumRadius)
  {
    int safeNodeCount = Mathf.Max(1, totalNodeCount);
    float safeSpacing = Mathf.Max(0.1f, spacingFactor);
    float safeMinimum = Mathf.Max(0.1f, minimumRadius);

    return Mathf.Max(
      safeMinimum,
      safeSpacing * Mathf.Pow(safeNodeCount, 1f / 3f));
  }

  private void BuildLogicalGraph(List<NoteData> notes)
  {
    var orderedNotes = (notes ?? new List<NoteData>())
      .Where(note => note != null)
      .OrderBy(NoteKey, StringComparer.Ordinal)
      .ToList();

    _noteCount = orderedNotes.Count;

    var tagIdsByNote = new List<int>[_noteCount];
    var tagFrequencyById = new Dictionary<int, int>();

    for (int noteIndex = 0; noteIndex < _noteCount; noteIndex++)
    {
      var note = orderedNotes[noteIndex];
      var tagIds = (note.TagIds ?? new List<int>())
        .Distinct()
        .OrderBy(tagId => tagId)
        .ToList();

      tagIdsByNote[noteIndex] = tagIds;

      _nodes.Add(new Node
      {
        IsNote = true,
        Note = note,
        Key = NoteKey(note)
      });

      for (int i = 0; i < tagIds.Count; i++)
      {
        tagFrequencyById.TryGetValue(tagIds[i], out int count);
        tagFrequencyById[tagIds[i]] = count + 1;
      }
    }

    var tagNodeIndexById = new Dictionary<int, int>();
    foreach (int tagId in tagFrequencyById.Keys.OrderBy(tagId => tagId))
    {
      tagNodeIndexById[tagId] = _nodes.Count;
      _nodes.Add(new Node
      {
        IsNote = false,
        TagId = tagId,
        TagFrequency = tagFrequencyById[tagId],
        Key = $"tag:{tagId}"
      });
    }

    for (int noteIndex = 0; noteIndex < _noteCount; noteIndex++)
    {
      var tagIds = tagIdsByNote[noteIndex];
      for (int i = 0; i < tagIds.Count; i++)
      {
        int tagNodeIndex = tagNodeIndexById[tagIds[i]];
        var edge = new Edge(noteIndex, tagNodeIndex, 1f, EdgeKind.NoteTag);
        _tagEdges.Add(edge);
        _allEdges.Add(edge);
      }
    }

    BuildDirectNoteLinks();
  }

  private void BuildDirectNoteLinks()
  {
    if (!MapRuntimeContext.IsRuntimeMode || MapRuntimeContext.Links == null)
      return;

    var noteIndexById = new Dictionary<string, int>(StringComparer.Ordinal);
    for (int noteIndex = 0; noteIndex < _noteCount; noteIndex++)
    {
      string id = _nodes[noteIndex].Note?.Id;
      if (!string.IsNullOrWhiteSpace(id) && !noteIndexById.ContainsKey(id))
        noteIndexById[id] = noteIndex;
    }

    var maximumWeightByPair = new Dictionary<long, float>();
    foreach (var link in MapRuntimeContext.Links)
    {
      if (link == null ||
          !noteIndexById.TryGetValue(link.SourceId ?? string.Empty, out int source) ||
          !noteIndexById.TryGetValue(link.TargetId ?? string.Empty, out int target) ||
          source == target)
      {
        continue;
      }

      int a = Mathf.Min(source, target);
      int b = Mathf.Max(source, target);
      long pairKey = PairKey(a, b);
      float weight = link.Weight > 0f ? link.Weight : 1f;

      if (!maximumWeightByPair.TryGetValue(pairKey, out float previousWeight) ||
          weight > previousWeight)
      {
        maximumWeightByPair[pairKey] = weight;
      }
    }

    foreach (var pair in maximumWeightByPair.OrderBy(pair => pair.Key))
    {
      DecodePairKey(pair.Key, out int a, out int b);
      var edge = new Edge(a, b, Mathf.Max(0.01f, pair.Value), EdgeKind.DirectNoteLink);
      _noteLinks.Add(edge);
      _allEdges.Add(edge);
    }
  }

  private void BuildAdjacencyAndScores()
  {
    _adjacency = new List<Neighbor>[_nodes.Count];
    for (int i = 0; i < _adjacency.Length; i++)
      _adjacency[i] = new List<Neighbor>();

    AddAdjacency(_tagEdges);
    AddAdjacency(_noteLinks);

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      float directWeight = 0f;
      float tagWeight = 0f;

      for (int i = 0; i < _adjacency[nodeIndex].Count; i++)
      {
        var neighbor = _adjacency[nodeIndex][i];
        if (neighbor.Kind == EdgeKind.DirectNoteLink)
          directWeight += neighbor.Weight;
        else
          tagWeight += neighbor.Weight;
      }

      var node = _nodes[nodeIndex];
      float degreeBonus = Mathf.Pow(Mathf.Max(0, _adjacency[nodeIndex].Count), 0.7f) * degreeScoreBonus;

      node.StructuralScore = node.IsNote
        ? 1f + directWeight * directLinkScoreWeight + tagWeight * noteTagScoreWeight + degreeBonus
        : Mathf.Min(
          Mathf.Max(0.1f, maximumTagHubScore),
          Mathf.Sqrt(Mathf.Max(1, node.TagFrequency)) * tagNodeScoreMultiplier + degreeBonus * 0.35f);
    }
  }

  private void AddAdjacency(List<Edge> edges)
  {
    for (int i = 0; i < edges.Count; i++)
    {
      var edge = edges[i];
      _adjacency[edge.A].Add(new Neighbor(edge.B, edge.Weight, edge.Kind));
      _adjacency[edge.B].Add(new Neighbor(edge.A, edge.Weight, edge.Kind));
    }
  }

  private void FindConnectedComponents()
  {
    var visited = new bool[_nodes.Count];
    var queue = new Queue<int>();

    for (int start = 0; start < _nodes.Count; start++)
    {
      if (visited[start]) continue;

      var component = new Component();
      visited[start] = true;
      queue.Enqueue(start);

      while (queue.Count > 0)
      {
        int nodeIndex = queue.Dequeue();
        component.Nodes.Add(nodeIndex);

        for (int i = 0; i < _adjacency[nodeIndex].Count; i++)
        {
          int neighbor = _adjacency[nodeIndex][i].NodeIndex;
          if (visited[neighbor]) continue;

          visited[neighbor] = true;
          queue.Enqueue(neighbor);
        }
      }

      component.Nodes.Sort(CompareNodeKeys);
      component.Key = _nodes[component.Nodes[0]].Key;
      _components.Add(component);
    }

    _components.Sort((left, right) =>
    {
      int sizeOrder = right.Nodes.Count.CompareTo(left.Nodes.Count);
      return sizeOrder != 0
        ? sizeOrder
        : string.CompareOrdinal(left.Key, right.Key);
    });

    for (int componentIndex = 0; componentIndex < _components.Count; componentIndex++)
    {
      var component = _components[componentIndex];
      for (int offset = 0; offset < component.Nodes.Count; offset++)
      {
        var node = _nodes[component.Nodes[offset]];
        node.ComponentIndex = componentIndex;
        node.OrderInComponent = offset;
      }
    }
  }

  private void CalculateComponentGeometry()
  {
    _boundRadius = CalculateBoundRadius(_nodes.Count, nodeSpacingFactor, minimumBoundRadius);
    float componentSpread = _boundRadius * Mathf.Clamp(componentSpreadRatio, 0.05f, 0.95f);

    for (int componentIndex = 0; componentIndex < _components.Count; componentIndex++)
    {
      var component = _components[componentIndex];
      component.Center = componentIndex == 0
        ? Vector3.zero
        : FibonacciSpherePoint(componentIndex - 1, _components.Count - 1) * componentSpread;

      component.Radius = Mathf.Max(
        minimumNodeDistance * 2f,
        nodeSpacingFactor *
        Mathf.Pow(Mathf.Max(1, component.Nodes.Count), 1f / 3f) *
        Mathf.Max(0.2f, componentRadiusFactor));

      _boundRadius = Mathf.Max(
        _boundRadius,
        component.Center.magnitude + component.Radius + minimumNodeDistance * 2f);
    }
  }

  private void SelectAndPlaceLandmarks()
  {
    int remainingBudget = Mathf.Max(1, maxLandmarks);

    for (int componentIndex = 0; componentIndex < _components.Count && remainingBudget > 0; componentIndex++)
    {
      var component = _components[componentIndex];
      int desiredCount = Mathf.Clamp(
        Mathf.CeilToInt(Mathf.Pow(Mathf.Max(1, component.Nodes.Count), 1f / 3f) * landmarkCountFactor),
        1,
        Mathf.Max(1, maxLandmarksPerComponent));

      desiredCount = Mathf.Min(desiredCount, remainingBudget);
      SelectComponentLandmarks(component, desiredCount, strictExclusion: true);

      if (component.Landmarks.Count < desiredCount)
        SelectComponentLandmarks(component, desiredCount, strictExclusion: false);

      PlaceComponentLandmarks(component);
      remainingBudget -= component.Landmarks.Count;
    }

    _landmarkCount = _landmarkNodeIndices.Count;
  }

  private void SelectComponentLandmarks(Component component, int desiredCount, bool strictExclusion)
  {
    var orderedCandidates = component.Nodes
      .OrderBy(LandmarkTypeRank)
      .ThenByDescending(nodeIndex => _nodes[nodeIndex].StructuralScore)
      .ThenBy(nodeIndex => _nodes[nodeIndex].Key, StringComparer.Ordinal)
      .ToList();

    for (int i = 0; i < orderedCandidates.Count && component.Landmarks.Count < desiredCount; i++)
    {
      int candidate = orderedCandidates[i];
      if (_nodes[candidate].IsLandmark)
        continue;

      if (strictExclusion &&
          IsNearExistingLandmark(candidate, component.Landmarks, landmarkExclusionGraphDepth))
      {
        continue;
      }

      var node = _nodes[candidate];
      node.IsLandmark = true;
      node.LandmarkOffset = _landmarkNodeIndices.Count;
      component.Landmarks.Add(candidate);
      _landmarkNodeIndices.Add(candidate);
    }
  }

  private int LandmarkTypeRank(int nodeIndex)
  {
    return preferNotesAsLandmarks && !_nodes[nodeIndex].IsNote ? 1 : 0;
  }

  private bool IsNearExistingLandmark(int candidate, List<int> existingLandmarks, int maxDepth)
  {
    int safeMaxDepth = Mathf.Clamp(maxDepth, 0, 5);
    if (safeMaxDepth <= 0 || existingLandmarks.Count == 0)
      return false;

    var visited = new HashSet<int>();
    var queue = new Queue<int>();
    var depthByNode = new Dictionary<int, int>();

    visited.Add(candidate);
    depthByNode[candidate] = 0;
    queue.Enqueue(candidate);

    while (queue.Count > 0)
    {
      int nodeIndex = queue.Dequeue();
      int depth = depthByNode[nodeIndex];

      if (depth > 0 && existingLandmarks.Contains(nodeIndex))
        return true;

      if (depth >= safeMaxDepth)
        continue;

      for (int i = 0; i < _adjacency[nodeIndex].Count; i++)
      {
        int neighbor = _adjacency[nodeIndex][i].NodeIndex;
        if (!visited.Add(neighbor))
          continue;

        depthByNode[neighbor] = depth + 1;
        queue.Enqueue(neighbor);
      }
    }

    return false;
  }

  private void PlaceComponentLandmarks(Component component)
  {
    int count = component.Landmarks.Count;
    float spread = component.Radius * Mathf.Clamp(landmarkSpreadRatio, 0.05f, 0.98f);

    for (int offset = 0; offset < count; offset++)
    {
      int nodeIndex = component.Landmarks[offset];
      var node = _nodes[nodeIndex];

      Vector3 localOffset = count <= 1
        ? Vector3.zero
        : FibonacciSpherePoint(offset, count) * spread;

      Vector3 organicOffset =
        StableDirection(node.Key, 101) *
        minimumNodeDistance *
        0.35f;

      node.LocalPosition = ClampToSphere(
        component.Center + localOffset + organicOffset,
        minimumNodeDistance * 0.5f);
    }
  }

  private void PropagateLandmarkInfluences()
  {
    _landmarkInfluences = new List<LandmarkInfluence>[_nodes.Count];
    for (int i = 0; i < _landmarkInfluences.Length; i++)
      _landmarkInfluences[i] = new List<LandmarkInfluence>();

    int safeDepth = Mathf.Clamp(landmarkPropagationDepth, 1, 8);
    int[] depthByNode = new int[_nodes.Count];
    var queue = new Queue<int>();

    for (int landmarkOffset = 0; landmarkOffset < _landmarkNodeIndices.Count; landmarkOffset++)
    {
      for (int i = 0; i < depthByNode.Length; i++)
        depthByNode[i] = -1;

      int landmarkNodeIndex = _landmarkNodeIndices[landmarkOffset];
      depthByNode[landmarkNodeIndex] = 0;
      queue.Clear();
      queue.Enqueue(landmarkNodeIndex);

      while (queue.Count > 0)
      {
        int nodeIndex = queue.Dequeue();
        int depth = depthByNode[nodeIndex];

        float weight = 1f / Mathf.Pow(
          1f + depth,
          Mathf.Max(0.25f, landmarkProximityPower));

        _landmarkInfluences[nodeIndex].Add(
          new LandmarkInfluence(landmarkNodeIndex, weight));

        if (depth >= safeDepth)
          continue;

        for (int i = 0; i < _adjacency[nodeIndex].Count; i++)
        {
          int neighbor = _adjacency[nodeIndex][i].NodeIndex;
          if (depthByNode[neighbor] >= 0)
            continue;

          depthByNode[neighbor] = depth + 1;
          queue.Enqueue(neighbor);
        }
      }
    }

    int safeInfluenceCap = Mathf.Clamp(maxLandmarkInfluencesPerNode, 1, 16);
    for (int nodeIndex = 0; nodeIndex < _landmarkInfluences.Length; nodeIndex++)
    {
      var influences = _landmarkInfluences[nodeIndex];
      influences.Sort((left, right) => right.Weight.CompareTo(left.Weight));

      if (influences.Count > safeInfluenceCap)
        influences.RemoveRange(safeInfluenceCap, influences.Count - safeInfluenceCap);
    }
  }

  private void PlaceNodesFromLandmarks()
  {
    for (int componentIndex = 0; componentIndex < _components.Count; componentIndex++)
    {
      var component = _components[componentIndex];
      for (int i = 0; i < component.Nodes.Count; i++)
      {
        int nodeIndex = component.Nodes[i];
        var node = _nodes[nodeIndex];
        if (node.IsLandmark)
          continue;

        node.LocalPosition = ResolveNodePositionFromInfluences(nodeIndex, component);
      }
    }
  }

  private Vector3 ResolveNodePositionFromInfluences(int nodeIndex, Component component)
  {
    var node = _nodes[nodeIndex];
    var influences = _landmarkInfluences[nodeIndex];

    if (influences.Count == 0)
    {
      return ClampToSphere(
        component.Center +
        ScrambledBallPoint(node.OrderInComponent, component.Nodes.Count, node.Key) *
        component.Radius *
        0.82f,
        minimumNodeDistance * 0.5f);
    }

    Vector3 weightedPosition = Vector3.zero;
    float totalWeight = 0f;
    float strongestWeight = 0f;

    for (int i = 0; i < influences.Count; i++)
    {
      var influence = influences[i];
      var landmark = _nodes[influence.LandmarkNodeIndex];
      weightedPosition += landmark.LocalPosition * influence.Weight;
      totalWeight += influence.Weight;
      strongestWeight = Mathf.Max(strongestWeight, influence.Weight);
    }

    Vector3 basePosition = totalWeight > 0f
      ? weightedPosition / totalWeight
      : component.Center;

    float confidence = Mathf.Clamp01(totalWeight);
    basePosition = Vector3.Lerp(component.Center, basePosition, confidence);

    float scatter = Mathf.Lerp(
      component.Radius * 0.32f,
      minimumNodeDistance * 1.15f,
      Mathf.Clamp01(strongestWeight));

    scatter *= Mathf.Lerp(0.65f, 1.35f, Hash01(node.Key, 211));

    Vector3 direction =
      StableDirection(node.Key, 223) +
      ScrambledBallPoint(node.OrderInComponent, component.Nodes.Count, node.Key) * 0.45f;

    if (direction.sqrMagnitude <= MIN_SQR_DISTANCE)
      direction = StableDirection(node.Key, 227);

    return ClampToSphere(
      basePosition + direction.normalized * scatter,
      minimumNodeDistance * 0.5f);
  }

  private void RelaxLinkedStress()
  {
    int safePasses = Mathf.Clamp(linkRelaxationPasses, 0, 48);
    if (safePasses == 0 || _allEdges.Count == 0)
      return;

    EnsureCorrectionBuffers();

    for (int pass = 0; pass < safePasses; pass++)
    {
      Array.Clear(_corrections, 0, _corrections.Length);
      Array.Clear(_correctionCounts, 0, _correctionCounts.Length);

      for (int edgeIndex = 0; edgeIndex < _allEdges.Count; edgeIndex++)
        ApplyStressCorrection(_allEdges[edgeIndex]);

      ApplyCorrections();
    }
  }

  private void ApplyStressCorrection(Edge edge)
  {
    var a = _nodes[edge.A];
    var b = _nodes[edge.B];

    Vector3 delta = b.LocalPosition - a.LocalPosition;
    float distanceSqr = delta.sqrMagnitude;

    Vector3 direction;
    float distance;
    if (distanceSqr <= MIN_SQR_DISTANCE)
    {
      direction = StablePairDirection(edge.A, edge.B, 307);
      distance = 0f;
    }
    else
    {
      distance = Mathf.Sqrt(distanceSqr);
      direction = delta / distance;
    }

    float restLength = ResolveRestLength(edge);
    float extension = distance - restLength;
    float pull = Mathf.Clamp01(linkPull);
    float weightScale = edge.Kind == EdgeKind.DirectNoteLink
      ? Mathf.Clamp(Mathf.Sqrt(Mathf.Max(0.01f, edge.Weight)), 0.55f, 2.6f)
      : 0.58f;

    float move = Mathf.Clamp(
      extension * pull * weightScale,
      -Mathf.Max(0.01f, maxMovePerPass),
      Mathf.Max(0.01f, maxMovePerPass));

    Vector3 correction = direction * (move * 0.5f);

    _corrections[edge.A] += correction * NodeMobility(a);
    _corrections[edge.B] -= correction * NodeMobility(b);
    _correctionCounts[edge.A]++;
    _correctionCounts[edge.B]++;
  }

  private float ResolveRestLength(Edge edge)
  {
    if (edge.Kind == EdgeKind.NoteTag)
      return Mathf.Max(0.01f, noteTagRestLength);

    return Mathf.Clamp(
      Mathf.Max(0.01f, directLinkRestLength) /
      Mathf.Sqrt(Mathf.Max(0.01f, edge.Weight)),
      Mathf.Max(0.01f, minimumDirectLinkRestLength),
      Mathf.Max(0.01f, directLinkRestLength) * 1.6f);
  }

  private float NodeMobility(Node node)
  {
    return node.IsLandmark
      ? Mathf.Clamp01(landmarkMobility)
      : 1f;
  }

  private void ApplyCorrections()
  {
    float safeMaxMove = Mathf.Max(0.01f, maxMovePerPass);

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      int correctionCount = _correctionCounts[nodeIndex];
      if (correctionCount <= 0)
        continue;

      Vector3 correction = _corrections[nodeIndex] / correctionCount;
      if (correction.sqrMagnitude <= MIN_SQR_DISTANCE)
        continue;

      if (correction.magnitude > safeMaxMove)
        correction = correction.normalized * safeMaxMove;

      _nodes[nodeIndex].LocalPosition = ClampToSphere(
        _nodes[nodeIndex].LocalPosition + correction,
        minimumNodeDistance * 0.5f);
    }
  }

  private void ResolveResidualSeparation()
  {
    int safePasses = Mathf.Clamp(separationPasses, 0, 16);
    if (safePasses == 0 || _nodes.Count <= 1)
      return;

    EnsureCorrectionBuffers();

    for (int pass = 0; pass < safePasses; pass++)
    {
      Array.Clear(_corrections, 0, _corrections.Length);
      Array.Clear(_correctionCounts, 0, _correctionCounts.Length);

      ApplySeparationPass();
      ApplyCorrections();
    }
  }

  private void ApplySeparationPass()
  {
    float safeMinimumDistance = Mathf.Max(0.01f, minimumNodeDistance);
    float safeMinimumDistanceSqr = safeMinimumDistance * safeMinimumDistance;
    int safeMaxChecks = Mathf.Max(1, maxSeparationChecksPerNode);

    BuildSeparationGrid(safeMinimumDistance);

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      var node = _nodes[nodeIndex];
      Vector3Int origin = ToCell(node.LocalPosition, safeMinimumDistance);
      int checks = 0;

      for (int x = -1; x <= 1 && checks < safeMaxChecks; x++)
        for (int y = -1; y <= 1 && checks < safeMaxChecks; y++)
          for (int z = -1; z <= 1 && checks < safeMaxChecks; z++)
          {
            if (!_separationGrid.TryGetValue(origin + new Vector3Int(x, y, z), out var bucket))
              continue;

            for (int bucketOffset = 0; bucketOffset < bucket.Count && checks < safeMaxChecks; bucketOffset++)
            {
              int otherIndex = bucket[bucketOffset];
              if (otherIndex <= nodeIndex)
                continue;

              checks++;
              _separationPairChecks++;

              var other = _nodes[otherIndex];
              Vector3 delta = other.LocalPosition - node.LocalPosition;
              float distanceSqr = delta.sqrMagnitude;
              if (distanceSqr >= safeMinimumDistanceSqr)
                continue;

              Vector3 direction;
              float distance;
              if (distanceSqr <= MIN_SQR_DISTANCE)
              {
                direction = StablePairDirection(nodeIndex, otherIndex, 401);
                distance = 0f;
              }
              else
              {
                distance = Mathf.Sqrt(distanceSqr);
                direction = delta / distance;
              }

              float separation = safeMinimumDistance - distance;
              Vector3 correction = direction * (separation * 0.5f);

              _corrections[nodeIndex] -= correction * NodeMobility(node);
              _corrections[otherIndex] += correction * NodeMobility(other);
              _correctionCounts[nodeIndex]++;
              _correctionCounts[otherIndex]++;
            }
          }
    }
  }

  private void EnsureCorrectionBuffers()
  {
    if (_corrections.Length == _nodes.Count &&
        _correctionCounts.Length == _nodes.Count)
    {
      return;
    }

    _corrections = new Vector3[_nodes.Count];
    _correctionCounts = new int[_nodes.Count];
  }

  private void BuildSeparationGrid(float cellSize)
  {
    float safeCellSize = Mathf.Max(0.1f, cellSize);
    ResetSeparationGrid();

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      Vector3Int cell = ToCell(_nodes[nodeIndex].LocalPosition, safeCellSize);
      GetOrCreateSeparationBucket(cell).Add(nodeIndex);
    }
  }

  private void ResetSeparationGrid()
  {
    _separationGrid.Clear();
    _usedSeparationBuckets = 0;
  }

  private List<int> GetOrCreateSeparationBucket(Vector3Int cell)
  {
    if (_separationGrid.TryGetValue(cell, out var bucket))
      return bucket;

    if (_usedSeparationBuckets < _separationBucketPool.Count)
    {
      bucket = _separationBucketPool[_usedSeparationBuckets];
      bucket.Clear();
    }
    else
    {
      bucket = new List<int>(8);
      _separationBucketPool.Add(bucket);
    }

    _usedSeparationBuckets++;
    _separationGrid[cell] = bucket;
    return bucket;
  }

  private void InstantiateNodes()
  {
    if (starTemplate == null)
    {
      UnityEngine.Debug.LogError("[LandmarkStress] Missing starTemplate.");
      return;
    }

    bool canCreateTags = tagNodeTemplate != null;
    if (!canCreateTags && _nodes.Count > _noteCount)
      UnityEngine.Debug.LogWarning("[LandmarkStress] Missing tagNodeTemplate. Tag nodes were skipped.");

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      var node = _nodes[nodeIndex];
      Vector3 worldPosition = layoutParent
        ? layoutParent.TransformPoint(node.LocalPosition)
        : node.LocalPosition;

      if (node.IsNote)
      {
        node.Star = starTemplate.Instantiate(worldPosition, node.Note, layoutParent);
        if (node.Star != null)
          _stars.Add(node.Star);
      }
      else if (canCreateTags)
      {
        node.TagNode = TagNode.Create(tagNodeTemplate, worldPosition, node.TagId, layoutParent);
        if (node.TagNode != null)
          node.TagNode.transform.localScale = Vector3.one * tagScale;
      }
    }
  }

  private void InstantiateLines()
  {
    if (edgePrefab == null || maxVisibleEdges <= 0)
      return;

    int safeBudget = Mathf.Max(0, maxVisibleEdges);
    int directBudget = Mathf.Clamp(
      Mathf.RoundToInt(safeBudget * Mathf.Clamp01(directLinkBudgetRatio)),
      0,
      safeBudget);

    var orderedDirectLinks = _noteLinks
      .OrderByDescending(edge => edge.Weight)
      .ThenBy(edge => edge.A)
      .ThenBy(edge => edge.B)
      .ToList();

    var orderedTagEdges = _tagEdges
      .Where(IsVisibleTagEdgeCandidate)
      .OrderBy(edge => EdgeLengthSqr(edge))
      .ThenBy(edge => edge.A)
      .ThenBy(edge => edge.B)
      .ToList();

    var instantiatedPairs = new HashSet<long>();
    int added = 0;

    added += InstantiateLinesFromEdges(
      orderedDirectLinks,
      directBudget,
      instantiatedPairs);

    added += InstantiateLinesFromEdges(
      orderedTagEdges,
      safeBudget - added,
      instantiatedPairs);

    if (added < safeBudget)
    {
      InstantiateLinesFromEdges(
        orderedDirectLinks,
        safeBudget - added,
        instantiatedPairs);
    }
  }

  private bool IsVisibleTagEdgeCandidate(Edge edge)
  {
    if (edge.Kind != EdgeKind.NoteTag)
      return true;

    float maxLength =
      Mathf.Max(0.01f, noteTagRestLength) *
      Mathf.Max(1f, maxVisibleTagEdgeRestMultiplier);

    return EdgeLengthSqr(edge) <= maxLength * maxLength;
  }

  private float EdgeLengthSqr(Edge edge)
  {
    return (_nodes[edge.B].LocalPosition - _nodes[edge.A].LocalPosition).sqrMagnitude;
  }

  private int InstantiateLinesFromEdges(
    IEnumerable<Edge> edges,
    int maxCount,
    HashSet<long> instantiatedPairs)
  {
    int added = 0;
    int safeMaxCount = Mathf.Max(0, maxCount);

    foreach (var edge in edges)
    {
      if (added >= safeMaxCount)
        break;

      int aIndex = Mathf.Min(edge.A, edge.B);
      int bIndex = Mathf.Max(edge.A, edge.B);
      long pairKey = PairKey(aIndex, bIndex);

      if (!instantiatedPairs.Add(pairKey))
        continue;

      var a = _nodes[edge.A].VisualTransform;
      var b = _nodes[edge.B].VisualTransform;
      if (!a || !b)
        continue;

      var line = Instantiate(edgePrefab, layoutParent);
      line.positionCount = 2;
      line.SetPosition(0, a.position);
      line.SetPosition(1, b.position);
      _lines.Add(line);
      added++;
    }

    return added;
  }

  private int CompareNodeKeys(int left, int right)
  {
    return string.CompareOrdinal(_nodes[left].Key, _nodes[right].Key);
  }

  private Vector3 ClampToSphere(Vector3 position, float margin)
  {
    float radius = Mathf.Max(0.01f, _boundRadius - Mathf.Max(0f, margin));
    return position.sqrMagnitude <= radius * radius
      ? position
      : position.normalized * radius;
  }

  private static Vector3Int ToCell(Vector3 position, float cellSize)
  {
    float safeCellSize = Mathf.Max(0.1f, cellSize);
    return new Vector3Int(
      Mathf.RoundToInt(position.x / safeCellSize),
      Mathf.RoundToInt(position.y / safeCellSize),
      Mathf.RoundToInt(position.z / safeCellSize));
  }

  private static Vector3 FibonacciSpherePoint(int index, int count)
  {
    if (count <= 1)
      return Vector3.zero;

    float t = (index + 0.5f) / count;
    float y = 1f - 2f * t;
    float radial = Mathf.Sqrt(Mathf.Max(0f, 1f - y * y));
    float angle = index * GOLDEN_ANGLE_RAD;

    return new Vector3(
      Mathf.Cos(angle) * radial,
      y,
      Mathf.Sin(angle) * radial);
  }

  private static Vector3 ScrambledBallPoint(int index, int count, string key)
  {
    if (count <= 1)
      return Vector3.zero;

    Vector3 direction = StableDirection(key, 503);
    float radialSample = Mathf.Repeat(
      (index + 0.5f) * GOLDEN_RATIO_CONJUGATE,
      1f);

    float radius = Mathf.Pow(
      Mathf.Lerp(0.08f, 1f, radialSample),
      1f / 3f);

    return direction * radius;
  }

  private static Vector3 StableDirection(string key, int salt)
  {
    float y = Mathf.Lerp(-1f, 1f, Hash01(key, salt));
    float radial = Mathf.Sqrt(Mathf.Max(0f, 1f - y * y));
    float angle = Hash01(key, salt + 1) * Mathf.PI * 2f;

    return new Vector3(
      Mathf.Cos(angle) * radial,
      y,
      Mathf.Sin(angle) * radial);
  }

  private static Vector3 StablePairDirection(int a, int b, int salt)
  {
    int min = Mathf.Min(a, b);
    int max = Mathf.Max(a, b);
    return StableDirection($"pair:{min}:{max}", salt);
  }

  private static string NoteKey(NoteData note)
  {
    return note == null
      ? "note:<null>"
      : $"note:{note.Id ?? string.Empty}|{note.Path ?? string.Empty}|{note.Name ?? string.Empty}";
  }

  private static float Hash01(string value, int salt)
  {
    return (StableHash(value, salt) & 0x00FFFFFFu) / 16777215f;
  }

  private static uint StableHash(string value, int salt)
  {
    unchecked
    {
      uint hash = (2166136261u ^ (uint)salt) * 16777619u;
      string safe = value ?? string.Empty;

      for (int i = 0; i < safe.Length; i++)
        hash = (hash ^ safe[i]) * 16777619u;

      return hash;
    }
  }

  private static long PairKey(int a, int b)
  {
    return ((long)(uint)a << 32) | (uint)b;
  }

  private static void DecodePairKey(long key, out int a, out int b)
  {
    a = (int)(key >> 32);
    b = (int)(key & 0xFFFFFFFFL);
  }
}
