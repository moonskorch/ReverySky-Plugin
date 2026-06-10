using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using UnityEngine;

// Evaluation:
// - At ~2K notes, the clustering looks excellent: the map has a strong shape without collapsing into an artificial sphere.
// - Tagless map has a strange vertical shape.
// - Cluster separation is clear, and the clusters do not degrade into spherical blobs.
// - As graph size increases, especially with more hub-heavy structures, the layout becomes prone to congestion.
// [Cartographer] Graph built in 27113,7 ms (notes=10000, engine=StaticLinks)
// [Cartographer] Graph built in 13713,7 ms (notes=5000, engine=StaticLinks)
// [Cartographer] Graph built in 3746,4 ms (notes=2000, engine=StaticLinks)
// [CartographerSettledForces/BarnesHut] Built notes=2000, tags=100, tagEdges=4986, noteLinks=2496, visibleEdges=1500, components=4, iterations=52, boundRadius=108,8, octreePeakNodes=1357, treeVisits=13325357, treeApproximations=3872759, exactLeafChecks=16543129, skippedExactLeafBodies=0, cappedTraversals=0, overlapChecks=10477, totalMs=3743,2, ClearGraphMs=0,5, BuildLogicalGraphMs=15,9, CalculateBoundRadiusMs=0,0, FindConnectedComponentsMs=2,5, InitializeStablePositionsMs=2,9, RelaxLayoutMs=3320,6, BuildBarnesHutTreeMs=37,4, ApplyBarnesHutRepulsionMs=3235,3, ApplySpringsTagEdgesMs=18,8, ApplySpringsDirectLinksMs=14,4, ApplyAnchorsMs=2,4, IntegratePositionsMs=11,3, ResolveResidualOverlapsMs=9,9, InstantiateNodesMs=368,8, InstantiateLinesMs=22,1
// - Defect: the map center is offset toward the edge, causing part of the layout to flatten against the bound-radius limit.
// Assessment:
// - Visually, this variant is promising for medium-sized and more strongly clustered graphs.
// - It is not viable yet: performance must improve even for medium graph sizes, and the center-offset defect must be fixed.
// - After those fixes, it may still be worth keeping as an intermediate candidate.

/// <summary>
/// Static force-directed map for medium and large note graphs.
///
/// The engine calculates a bounded force layout once during BuildGraph(), then
/// instantiates the visual objects at their final positions. Runtime Tick() is
/// intentionally empty.
///
/// Scaling strategy:
/// - direct note links and note-tag relations are spring edges;
/// - Barnes-Hut octree repulsion approximates distant groups of nodes;
/// - the main settle pass avoids pairwise O(N^2) scans;
/// - a bounded spatial hash cleanup resolves only residual close overlaps;
/// - disconnected components receive stable centers before relaxation;
/// - layout iterations, octree traversal, overlap cleanup, and rendered edges are bounded.
/// </summary>
[DisallowMultipleComponent]
public class Engine_Barnes_v1 : MonoBehaviour, ICartographerEngine
{
  [Header("Prefabs & Parents")]
  [SerializeField] private StarSO starTemplate;
  [SerializeField] private Transform layoutParent;
  [SerializeField] private TagNodeSO tagNodeTemplate;
  [SerializeField] private LineRenderer edgePrefab;

  [Header("Dynamic sphere scaling")]
  [Tooltip("Primary map-density control. Larger values create a more relaxed map volume.")]
  [SerializeField, Min(0.1f)] private float nodeSpacingFactor = 8.5f;
  [SerializeField, Min(0.1f)] private float minimumBoundRadius = 14f;
  [SerializeField, Range(0.05f, 0.95f)] private float componentSpreadRatio = 0.78f;
  [SerializeField, Range(0.05f, 0.95f)] private float initialLocalSpreadRatio = 0.86f;
  [SerializeField, Range(0.1f, 2f)] private float taggedNoteSeedDistanceFactor = 0.95f;

  [Header("Settled relaxation")]
  [SerializeField, Range(1, 1000)] private int maxIterations = 88;
  [SerializeField, Range(0, 1000)] private int minIterations = 28;
  [SerializeField, Range(1, 64)] private int stableIterationsRequired = 6;
  [Tooltip("At this physical-node count the engine uses largeGraphIterationFloor as the maximum iteration budget.")]
  [SerializeField, Min(1)] private int largeGraphNodeCount = 1800;
  [SerializeField, Range(1, 1000)] private int largeGraphIterationFloor = 52;
  [SerializeField, Min(0.0001f)] private float settleEpsilon = 0.014f;
  [SerializeField, Range(0.001f, 0.5f)] private float simulationStep = 0.052f;
  [SerializeField, Range(0.01f, 0.999f)] private float damping = 0.76f;
  [SerializeField, Min(0.01f)] private float maxNodeStep = 1.2f;

  [Header("Springs")]
  [SerializeField, Min(0.01f)] private float noteTagRestLength = 8.0f;
  [SerializeField, Min(0.01f)] private float directLinkRestLength = 7.0f;
  [SerializeField, Min(0.01f)] private float minimumDirectLinkRestLength = 2.8f;
  [SerializeField, Min(0f)] private float noteTagSpringStrength = 0.95f;
  [SerializeField, Min(0f)] private float directLinkSpringStrength = 1.55f;
  [Tooltip("Keep small. This prevents component drift without collapsing the map into a ball.")]
  [SerializeField, Min(0f)] private float componentGravityStrength = 0.016f;
  [SerializeField, Min(0f)] private float tagAnchorStrength = 0.07f;
  [SerializeField, Min(0.1f)] private float tagMass = 2.0f;

  [Header("Barnes-Hut repulsion")]
  [SerializeField, Min(0f)] private float repulsionStrength = 30f;
  [SerializeField, Min(0.01f)] private float repulsionSofteningDistance = 1.8f;
  [Tooltip("Lower is more accurate and slower. Values around 0.65-0.85 are a practical range.")]
  [SerializeField, Range(0.2f, 1.5f)] private float barnesHutTheta = 0.82f;
  [SerializeField, Range(1, 32)] private int octreeLeafCapacity = 6;
  [SerializeField, Range(4, 24)] private int octreeMaxDepth = 16;
  [Tooltip("Hard per-node traversal cap. Keeps pathological octree shapes bounded.")]
  [SerializeField, Range(32, 8192)] private int maxBarnesHutVisitsPerNode = 512;
  [Tooltip("Hard cap for exact bodies inside one deepest leaf. Normally leafCapacity keeps this much lower.")]
  [SerializeField, Range(4, 512)] private int maxExactLeafChecksPerLeaf = 32;

  [Header("Residual overlap cleanup")]
  [SerializeField, Range(0, 16)] private int overlapCleanupPasses = 2;
  [SerializeField, Min(0.01f)] private float minimumNodeDistance = 2.4f;
  [SerializeField, Range(8, 4096)] private int maxOverlapChecksPerNode = 96;

  [Header("Visual")]
  [SerializeField, Min(0.01f)] private float tagScale = 0.7f;
  [SerializeField, Min(0)] private int maxVisibleEdges = 1500;
  [SerializeField, Range(0f, 1f)] private float directLinkBudgetRatio = 0.6f;

  private const float GOLDEN_ANGLE_RAD = 2.39996323f;
  private const float MIN_SQR_DISTANCE = 0.000001f;

  private float _boundRadius;
  private int _noteCount;
  private int _settledIterations;
  private long _barnesHutNodeVisits;
  private long _barnesHutApproximations;
  private long _barnesHutExactChecks;
  private long _barnesHutSkippedExactLeafBodies;
  private long _barnesHutCappedTraversals;
  private int _peakOctreeNodes;
  private long _overlapPairChecks;

  private double _buildBarnesHutTreeMs;
  private double _applyBarnesHutRepulsionMs;
  private double _applyTagSpringsMs;
  private double _applyDirectLinkSpringsMs;
  private double _applyAnchorsMs;
  private double _integratePositionsMs;

  private readonly List<Node> _nodes = new();
  private readonly List<Edge> _tagEdges = new();
  private readonly List<Edge> _noteLinks = new();
  private readonly List<Component> _components = new();
  private readonly List<LineRenderer> _lines = new();
  private readonly List<Star> _stars = new();

  private List<int>[] _tagNodeIndicesByNote = Array.Empty<List<int>>();

  private readonly Dictionary<Vector3Int, List<int>> _grid = new();
  private readonly List<List<int>> _gridBucketPool = new();
  private int _usedGridBuckets;

  private Vector3[] _overlapCorrections = Array.Empty<Vector3>();
  private int[] _overlapCorrectionCounts = Array.Empty<int>();

  private readonly List<OctreeNode> _octreeNodePool = new();
  private int _usedOctreeNodes;
  private int _octreeRootIndex = -1;

  private sealed class Node
  {
    public bool IsNote;
    public NoteData Note;
    public int TagId;
    public int TagFrequency;
    public string Key;

    public float Mass;
    public Vector3 Position;
    public Vector3 Velocity;
    public Vector3 Force;
    public Vector3 InitialPosition;
    public Vector3 ComponentCenter;

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
    public readonly float RestLength;
    public readonly EdgeKind Kind;

    public Edge(int a, int b, float weight, float restLength, EdgeKind kind)
    {
      A = a;
      B = b;
      Weight = weight;
      RestLength = restLength;
      Kind = kind;
    }
  }

  private sealed class Component
  {
    public readonly List<int> Nodes = new();
    public string Key;
    public Vector3 Center;
  }

  private sealed class OctreeNode
  {
    public Vector3 Center;
    public float HalfSize;
    public float Mass;
    public Vector3 WeightedPositionSum;
    public readonly List<int> Bodies = new(8);
    public readonly int[] Children = new int[8];
    public bool HasChildren;

    public bool IsLeaf => !HasChildren;

    public void Reset(Vector3 center, float halfSize)
    {
      Center = center;
      HalfSize = halfSize;
      Mass = 0f;
      WeightedPositionSum = Vector3.zero;
      Bodies.Clear();
      HasChildren = false;

      for (int i = 0; i < Children.Length; i++)
        Children[i] = -1;
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
    // The settled layout is intentionally frozen after BuildGraph().
  }

  public void BuildGraph(List<NoteData> notes)
  {
    var totalStopwatch = Stopwatch.StartNew();

    var clearStopwatch = Stopwatch.StartNew();
    ClearGraph();
    clearStopwatch.Stop();

    var logicalStopwatch = Stopwatch.StartNew();
    BuildLogicalGraph(notes);
    logicalStopwatch.Stop();

    var radiusStopwatch = Stopwatch.StartNew();
    _boundRadius = CalculateBoundRadius(
      _nodes.Count,
      nodeSpacingFactor,
      minimumBoundRadius);
    radiusStopwatch.Stop();

    if (_noteCount == 0)
    {
      totalStopwatch.Stop();
      UnityEngine.Debug.Log(
        $"[CartographerSettledForces/BarnesHut] BuildGraph totalMs={totalStopwatch.Elapsed.TotalMilliseconds:F1}, " +
        $"ClearGraphMs={clearStopwatch.Elapsed.TotalMilliseconds:F1}, " +
        $"BuildLogicalGraphMs={logicalStopwatch.Elapsed.TotalMilliseconds:F1}, " +
        $"CalculateBoundRadiusMs={radiusStopwatch.Elapsed.TotalMilliseconds:F1}, notes=0");
      return;
    }

    var componentsStopwatch = Stopwatch.StartNew();
    FindConnectedComponents();
    componentsStopwatch.Stop();

    var initializeStopwatch = Stopwatch.StartNew();
    InitializeStablePositions();
    initializeStopwatch.Stop();

    var settleStopwatch = Stopwatch.StartNew();
    RelaxLayout();
    settleStopwatch.Stop();

    var overlapStopwatch = Stopwatch.StartNew();
    ResolveResidualOverlaps();
    overlapStopwatch.Stop();

    var instantiateNodesStopwatch = Stopwatch.StartNew();
    InstantiateNodes();
    instantiateNodesStopwatch.Stop();

    var instantiateLinesStopwatch = Stopwatch.StartNew();
    InstantiateLines();
    instantiateLinesStopwatch.Stop();

    totalStopwatch.Stop();

    UnityEngine.Debug.Log(
      $"[CartographerSettledForces/BarnesHut] Built notes={_noteCount}, tags={_nodes.Count - _noteCount}, " +
      $"tagEdges={_tagEdges.Count}, noteLinks={_noteLinks.Count}, visibleEdges={_lines.Count}, " +
      $"components={_components.Count}, iterations={_settledIterations}, boundRadius={_boundRadius:F1}, " +
      $"octreePeakNodes={_peakOctreeNodes}, treeVisits={_barnesHutNodeVisits}, " +
      $"treeApproximations={_barnesHutApproximations}, exactLeafChecks={_barnesHutExactChecks}, " +
      $"skippedExactLeafBodies={_barnesHutSkippedExactLeafBodies}, " +
      $"cappedTraversals={_barnesHutCappedTraversals}, overlapChecks={_overlapPairChecks}, " +
      $"totalMs={totalStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"ClearGraphMs={clearStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"BuildLogicalGraphMs={logicalStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"CalculateBoundRadiusMs={radiusStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"FindConnectedComponentsMs={componentsStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"InitializeStablePositionsMs={initializeStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"RelaxLayoutMs={settleStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"BuildBarnesHutTreeMs={_buildBarnesHutTreeMs:F1}, " +
      $"ApplyBarnesHutRepulsionMs={_applyBarnesHutRepulsionMs:F1}, " +
      $"ApplySpringsTagEdgesMs={_applyTagSpringsMs:F1}, " +
      $"ApplySpringsDirectLinksMs={_applyDirectLinkSpringsMs:F1}, " +
      $"ApplyAnchorsMs={_applyAnchorsMs:F1}, " +
      $"IntegratePositionsMs={_integratePositionsMs:F1}, " +
      $"ResolveResidualOverlapsMs={overlapStopwatch.Elapsed.TotalMilliseconds:F1}, " +
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
      var transformToDestroy = _nodes[i].VisualTransform;
      if (transformToDestroy) Destroy(transformToDestroy.gameObject);
    }

    _nodes.Clear();
    _tagEdges.Clear();
    _noteLinks.Clear();
    _components.Clear();
    _stars.Clear();

    _tagNodeIndicesByNote = Array.Empty<List<int>>();
    _overlapCorrections = Array.Empty<Vector3>();
    _overlapCorrectionCounts = Array.Empty<int>();

    _noteCount = 0;
    _settledIterations = 0;
    _barnesHutNodeVisits = 0;
    _barnesHutApproximations = 0;
    _barnesHutExactChecks = 0;
    _barnesHutSkippedExactLeafBodies = 0;
    _barnesHutCappedTraversals = 0;
    _peakOctreeNodes = 0;
    _overlapPairChecks = 0;

    _buildBarnesHutTreeMs = 0d;
    _applyBarnesHutRepulsionMs = 0d;
    _applyTagSpringsMs = 0d;
    _applyDirectLinkSpringsMs = 0d;
    _applyAnchorsMs = 0d;
    _integratePositionsMs = 0d;

    ResetSpatialGrid();
    ResetOctree();
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
    _tagNodeIndicesByNote = new List<int>[_noteCount];

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
      _tagNodeIndicesByNote[noteIndex] = new List<int>(tagIds.Count);
      _nodes.Add(new Node
      {
        IsNote = true,
        Note = note,
        Key = NoteKey(note),
        Mass = 1f
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
        Key = $"tag:{tagId}",
        Mass = Mathf.Max(0.1f, tagMass)
      });
    }

    for (int noteIndex = 0; noteIndex < _noteCount; noteIndex++)
    {
      var tagIds = tagIdsByNote[noteIndex];
      for (int i = 0; i < tagIds.Count; i++)
      {
        int tagNodeIndex = tagNodeIndexById[tagIds[i]];
        _tagNodeIndicesByNote[noteIndex].Add(tagNodeIndex);
        _tagEdges.Add(new Edge(
          noteIndex,
          tagNodeIndex,
          weight: 1f,
          restLength: Mathf.Max(0.01f, noteTagRestLength),
          kind: EdgeKind.NoteTag));
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

      float safeWeight = Mathf.Max(0.01f, pair.Value);
      float restLength = Mathf.Clamp(
        directLinkRestLength / Mathf.Sqrt(safeWeight),
        minimumDirectLinkRestLength,
        directLinkRestLength * 1.5f);

      _noteLinks.Add(new Edge(
        a,
        b,
        safeWeight,
        restLength,
        EdgeKind.DirectNoteLink));
    }
  }

  private void FindConnectedComponents()
  {
    var adjacency = new List<int>[_nodes.Count];
    for (int i = 0; i < adjacency.Length; i++)
      adjacency[i] = new List<int>();

    AddAdjacency(_tagEdges, adjacency);
    AddAdjacency(_noteLinks, adjacency);

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

        for (int i = 0; i < adjacency[nodeIndex].Count; i++)
        {
          int neighbor = adjacency[nodeIndex][i];
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
  }

  private static void AddAdjacency(List<Edge> edges, List<int>[] adjacency)
  {
    for (int i = 0; i < edges.Count; i++)
    {
      adjacency[edges[i].A].Add(edges[i].B);
      adjacency[edges[i].B].Add(edges[i].A);
    }
  }

  private void InitializeStablePositions()
  {
    float componentSpread =
      _boundRadius *
      Mathf.Clamp(componentSpreadRatio, 0.05f, 0.95f);

    for (int componentIndex = 0; componentIndex < _components.Count; componentIndex++)
    {
      var component = _components[componentIndex];
      component.Center = componentIndex == 0
        ? Vector3.zero
        : FibonacciSpherePoint(componentIndex - 1, _components.Count - 1) * componentSpread;

      float maximumLocalSpread = Mathf.Max(
        0.1f,
        _boundRadius - component.Center.magnitude - minimumNodeDistance);

      float desiredLocalSpread = Mathf.Max(
        minimumNodeDistance * 2f,
        nodeSpacingFactor *
        Mathf.Pow(Mathf.Max(1, component.Nodes.Count), 1f / 3f) *
        Mathf.Clamp(initialLocalSpreadRatio, 0.05f, 0.95f));

      float localSpread = Mathf.Min(maximumLocalSpread, desiredLocalSpread);

      for (int offset = 0; offset < component.Nodes.Count; offset++)
      {
        int nodeIndex = component.Nodes[offset];
        var node = _nodes[nodeIndex];

        Vector3 seed =
          component.Center +
          FibonacciBallPoint(offset, component.Nodes.Count) * localSpread +
          StableDirection(node.Key, 17) * minimumNodeDistance * 0.25f;

        node.ComponentCenter = component.Center;
        node.Position = ClampToSphere(seed, minimumNodeDistance * 0.5f);
        node.InitialPosition = node.Position;
        node.Velocity = Vector3.zero;
        node.Force = Vector3.zero;
      }
    }

    // Notes with tags start close to their stable tag anchors. The later
    // relaxation pass still lets direct note links reshape the local graph.
    for (int noteIndex = 0; noteIndex < _noteCount; noteIndex++)
    {
      var tagNodeIndices = _tagNodeIndicesByNote[noteIndex];
      if (tagNodeIndices == null || tagNodeIndices.Count == 0)
        continue;

      Vector3 weightedAnchorSum = Vector3.zero;
      float totalWeight = 0f;

      for (int i = 0; i < tagNodeIndices.Count; i++)
      {
        var tagNode = _nodes[tagNodeIndices[i]];
        float weight = 1f / Mathf.Sqrt(Mathf.Max(1, tagNode.TagFrequency));
        weightedAnchorSum += tagNode.Position * weight;
        totalWeight += weight;
      }

      if (totalWeight <= 0f)
        continue;

      var note = _nodes[noteIndex];
      Vector3 tagSeed =
        weightedAnchorSum / totalWeight +
        StableDirection(note.Key, 29) *
        noteTagRestLength *
        Mathf.Max(0.1f, taggedNoteSeedDistanceFactor);

      note.Position = ClampToSphere(tagSeed, minimumNodeDistance * 0.5f);
      note.InitialPosition = note.Position;
    }
  }

  private void RelaxLayout()
  {
    int safeMaxIterations = ResolveIterationBudget();
    int safeMinIterations = Mathf.Clamp(minIterations, 0, safeMaxIterations);
    int safeStableIterations = Mathf.Max(1, stableIterationsRequired);
    float safeSimulationStep = Mathf.Clamp(simulationStep, 0.001f, 0.5f);
    float safeDamping = Mathf.Clamp(damping, 0.01f, 0.999f);
    float safeMaxNodeStep = Mathf.Max(0.01f, maxNodeStep);
    float safeSettleEpsilon = Mathf.Max(0.0001f, settleEpsilon);

    int consecutiveStableIterations = 0;

    var phaseStopwatch = new Stopwatch();

    for (int iteration = 0; iteration < safeMaxIterations; iteration++)
    {
      ClearForces();

      phaseStopwatch.Restart();
      BuildBarnesHutTree();
      phaseStopwatch.Stop();
      _buildBarnesHutTreeMs += phaseStopwatch.Elapsed.TotalMilliseconds;

      phaseStopwatch.Restart();
      ApplyBarnesHutRepulsion();
      phaseStopwatch.Stop();
      _applyBarnesHutRepulsionMs += phaseStopwatch.Elapsed.TotalMilliseconds;

      phaseStopwatch.Restart();
      ApplySprings(_tagEdges, noteTagSpringStrength);
      phaseStopwatch.Stop();
      _applyTagSpringsMs += phaseStopwatch.Elapsed.TotalMilliseconds;

      phaseStopwatch.Restart();
      ApplySprings(_noteLinks, directLinkSpringStrength);
      phaseStopwatch.Stop();
      _applyDirectLinkSpringsMs += phaseStopwatch.Elapsed.TotalMilliseconds;

      phaseStopwatch.Restart();
      ApplyAnchors();
      phaseStopwatch.Stop();
      _applyAnchorsMs += phaseStopwatch.Elapsed.TotalMilliseconds;

      phaseStopwatch.Restart();
      float totalMove = IntegratePositions(
        safeSimulationStep,
        safeDamping,
        safeMaxNodeStep);
      phaseStopwatch.Stop();
      _integratePositionsMs += phaseStopwatch.Elapsed.TotalMilliseconds;

      _settledIterations = iteration + 1;

      float averageMove = _nodes.Count > 0
        ? totalMove / _nodes.Count
        : 0f;

      if (_settledIterations >= safeMinIterations && averageMove <= safeSettleEpsilon)
      {
        consecutiveStableIterations++;
        if (consecutiveStableIterations >= safeStableIterations)
          break;
      }
      else
      {
        consecutiveStableIterations = 0;
      }
    }
  }

  private float IntegratePositions(
    float safeSimulationStep,
    float safeDamping,
    float safeMaxNodeStep)
  {
    float totalMove = 0f;

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      var node = _nodes[nodeIndex];

      node.Velocity =
        (node.Velocity + (node.Force / Mathf.Max(0.1f, node.Mass)) * safeSimulationStep) *
        safeDamping;

      Vector3 step = node.Velocity * safeSimulationStep;
      if (step.magnitude > safeMaxNodeStep)
        step = step.normalized * safeMaxNodeStep;

      node.Position = ClampToSphere(
        node.Position + step,
        minimumNodeDistance * 0.5f);

      totalMove += step.magnitude;
    }

    return totalMove;
  }

  private int ResolveIterationBudget()
  {
    int ceiling = Mathf.Max(1, maxIterations);
    int floor = Mathf.Clamp(largeGraphIterationFloor, 1, ceiling);
    int graphSizeAtFloor = Mathf.Max(1, largeGraphNodeCount);

    float sizeRatio = Mathf.Clamp01((float)_nodes.Count / graphSizeAtFloor);
    return Mathf.RoundToInt(Mathf.Lerp(ceiling, floor, sizeRatio));
  }

  private void ClearForces()
  {
    for (int i = 0; i < _nodes.Count; i++)
      _nodes[i].Force = Vector3.zero;
  }

  private void BuildBarnesHutTree()
  {
    ResetOctree();

    float rootHalfSize = Mathf.Max(
      minimumBoundRadius,
      _boundRadius + minimumNodeDistance + 0.1f);

    _octreeRootIndex = AllocateOctreeNode(Vector3.zero, rootHalfSize);

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
      InsertBody(_octreeRootIndex, nodeIndex, depth: 0);

    _peakOctreeNodes = Mathf.Max(_peakOctreeNodes, _usedOctreeNodes);
  }

  private void ResetOctree()
  {
    _usedOctreeNodes = 0;
    _octreeRootIndex = -1;
  }

  private int AllocateOctreeNode(Vector3 center, float halfSize)
  {
    OctreeNode node;
    if (_usedOctreeNodes < _octreeNodePool.Count)
    {
      node = _octreeNodePool[_usedOctreeNodes];
    }
    else
    {
      node = new OctreeNode();
      _octreeNodePool.Add(node);
    }

    node.Reset(center, halfSize);
    return _usedOctreeNodes++;
  }

  private void InsertBody(int octreeNodeIndex, int bodyIndex, int depth)
  {
    var treeNode = _octreeNodePool[octreeNodeIndex];
    var body = _nodes[bodyIndex];
    float bodyMass = Mathf.Max(0.1f, body.Mass);

    treeNode.Mass += bodyMass;
    treeNode.WeightedPositionSum += body.Position * bodyMass;

    int safeLeafCapacity = Mathf.Clamp(octreeLeafCapacity, 1, 32);
    int safeMaxDepth = Mathf.Clamp(octreeMaxDepth, 4, 24);

    if (treeNode.IsLeaf)
    {
      if (treeNode.Bodies.Count < safeLeafCapacity ||
          depth >= safeMaxDepth ||
          treeNode.HalfSize <= 0.01f)
      {
        treeNode.Bodies.Add(bodyIndex);
        return;
      }

      Subdivide(octreeNodeIndex);

      for (int existingBodyOffset = 0; existingBodyOffset < treeNode.Bodies.Count; existingBodyOffset++)
      {
        int existingBodyIndex = treeNode.Bodies[existingBodyOffset];
        InsertBodyIntoChild(octreeNodeIndex, existingBodyIndex, depth + 1);
      }

      treeNode.Bodies.Clear();
    }

    InsertBodyIntoChild(octreeNodeIndex, bodyIndex, depth + 1);
  }

  private void InsertBodyIntoChild(int parentIndex, int bodyIndex, int depth)
  {
    var parent = _octreeNodePool[parentIndex];
    int childOffset = ChildOffset(parent.Center, _nodes[bodyIndex].Position);
    int childIndex = parent.Children[childOffset];

    if (childIndex < 0)
    {
      float childHalfSize = parent.HalfSize * 0.5f;
      Vector3 childCenter = parent.Center + ChildCenterOffset(childOffset, childHalfSize);
      childIndex = AllocateOctreeNode(childCenter, childHalfSize);
      parent.Children[childOffset] = childIndex;
    }

    InsertBody(childIndex, bodyIndex, depth);
  }

  private void Subdivide(int octreeNodeIndex)
  {
    _octreeNodePool[octreeNodeIndex].HasChildren = true;
  }

  private void ApplyBarnesHutRepulsion()
  {
    if (_octreeRootIndex < 0 || repulsionStrength <= 0f)
      return;

    int safeVisitCap = Mathf.Max(32, maxBarnesHutVisitsPerNode);

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      int visits = 0;
      ApplyRepulsionFromTreeNode(
        targetNodeIndex: nodeIndex,
        octreeNodeIndex: _octreeRootIndex,
        visitCount: ref visits,
        visitCap: safeVisitCap);

      if (visits >= safeVisitCap)
        _barnesHutCappedTraversals++;
    }
  }

  private void ApplyRepulsionFromTreeNode(
    int targetNodeIndex,
    int octreeNodeIndex,
    ref int visitCount,
    int visitCap)
  {
    if (visitCount >= visitCap)
      return;

    visitCount++;
    _barnesHutNodeVisits++;

    var treeNode = _octreeNodePool[octreeNodeIndex];
    if (treeNode.Mass <= 0f)
      return;

    var target = _nodes[targetNodeIndex];

    if (treeNode.IsLeaf)
    {
      ApplyExactLeafRepulsion(targetNodeIndex, treeNode);
      return;
    }

    Vector3 centerOfMass = treeNode.WeightedPositionSum / treeNode.Mass;
    Vector3 away = target.Position - centerOfMass;
    float distanceSqr = away.sqrMagnitude;
    float distance = Mathf.Sqrt(Mathf.Max(MIN_SQR_DISTANCE, distanceSqr));
    float nodeWidth = treeNode.HalfSize * 2f;

    bool containsTarget = ContainsPoint(treeNode, target.Position);
    bool canApproximate =
      !containsTarget &&
      nodeWidth / distance <= Mathf.Clamp(barnesHutTheta, 0.2f, 1.5f);

    if (canApproximate)
    {
      ApplyAggregateRepulsion(targetNodeIndex, octreeNodeIndex, centerOfMass, treeNode.Mass);
      _barnesHutApproximations++;
      return;
    }

    for (int childOffset = 0; childOffset < treeNode.Children.Length; childOffset++)
    {
      int childIndex = treeNode.Children[childOffset];
      if (childIndex < 0) continue;

      ApplyRepulsionFromTreeNode(
        targetNodeIndex,
        childIndex,
        ref visitCount,
        visitCap);

      if (visitCount >= visitCap)
        return;
    }
  }

  private void ApplyExactLeafRepulsion(int targetNodeIndex, OctreeNode treeNode)
  {
    int safeCheckCap = Mathf.Max(4, maxExactLeafChecksPerLeaf);
    int appliedChecks = 0;

    for (int bodyOffset = 0; bodyOffset < treeNode.Bodies.Count; bodyOffset++)
    {
      int sourceNodeIndex = treeNode.Bodies[bodyOffset];
      if (sourceNodeIndex == targetNodeIndex)
        continue;

      if (appliedChecks >= safeCheckCap)
      {
        _barnesHutSkippedExactLeafBodies += treeNode.Bodies.Count - bodyOffset;
        break;
      }

      _barnesHutExactChecks++;
      appliedChecks++;
      ApplySingleSourceRepulsion(
        targetNodeIndex,
        sourceNodeIndex,
        Mathf.Max(0.1f, _nodes[sourceNodeIndex].Mass));
    }
  }

  private void ApplyAggregateRepulsion(
    int targetNodeIndex,
    int octreeNodeIndex,
    Vector3 sourceCenter,
    float sourceMass)
  {
    ApplyRepulsion(
      targetNodeIndex,
      sourceCenter,
      sourceMass,
      salt: 401 + octreeNodeIndex);
  }

  private void ApplySingleSourceRepulsion(
    int targetNodeIndex,
    int sourceNodeIndex,
    float sourceMass)
  {
    ApplyRepulsion(
      targetNodeIndex,
      _nodes[sourceNodeIndex].Position,
      sourceMass,
      salt: 503 + sourceNodeIndex);
  }

  private void ApplyRepulsion(
    int targetNodeIndex,
    Vector3 sourcePosition,
    float sourceMass,
    int salt)
  {
    var target = _nodes[targetNodeIndex];
    Vector3 away = target.Position - sourcePosition;
    float distanceSqr = away.sqrMagnitude;

    Vector3 direction;
    if (distanceSqr <= MIN_SQR_DISTANCE)
    {
      direction = StableDirection(target.Key, salt);
      distanceSqr = MIN_SQR_DISTANCE;
    }
    else
    {
      direction = away / Mathf.Sqrt(distanceSqr);
    }

    float softening = Mathf.Max(0.01f, repulsionSofteningDistance);
    float denominator = distanceSqr + softening * softening;
    float magnitude =
      Mathf.Max(0f, repulsionStrength) *
      Mathf.Max(0.1f, sourceMass) /
      denominator;

    target.Force += direction * magnitude;
  }

  private static int ChildOffset(Vector3 center, Vector3 position)
  {
    int result = 0;
    if (position.x >= center.x) result |= 1;
    if (position.y >= center.y) result |= 2;
    if (position.z >= center.z) result |= 4;
    return result;
  }

  private static Vector3 ChildCenterOffset(int childOffset, float childHalfSize)
  {
    return new Vector3(
      (childOffset & 1) != 0 ? childHalfSize : -childHalfSize,
      (childOffset & 2) != 0 ? childHalfSize : -childHalfSize,
      (childOffset & 4) != 0 ? childHalfSize : -childHalfSize);
  }

  private static bool ContainsPoint(OctreeNode treeNode, Vector3 position)
  {
    return
      Mathf.Abs(position.x - treeNode.Center.x) <= treeNode.HalfSize &&
      Mathf.Abs(position.y - treeNode.Center.y) <= treeNode.HalfSize &&
      Mathf.Abs(position.z - treeNode.Center.z) <= treeNode.HalfSize;
  }

  private void ApplySprings(List<Edge> edges, float springStrength)
  {
    float safeSpringStrength = Mathf.Max(0f, springStrength);
    if (safeSpringStrength <= 0f) return;

    for (int edgeIndex = 0; edgeIndex < edges.Count; edgeIndex++)
    {
      var edge = edges[edgeIndex];
      var a = _nodes[edge.A];
      var b = _nodes[edge.B];

      Vector3 delta = b.Position - a.Position;
      float distanceSqr = delta.sqrMagnitude;

      Vector3 direction;
      float distance;
      if (distanceSqr <= MIN_SQR_DISTANCE)
      {
        direction = StablePairDirection(edge.A, edge.B, 211);
        distance = 0f;
      }
      else
      {
        distance = Mathf.Sqrt(distanceSqr);
        direction = delta / distance;
      }

      float extension = distance - edge.RestLength;
      float weightScale = edge.Kind == EdgeKind.DirectNoteLink
        ? Mathf.Clamp(Mathf.Sqrt(Mathf.Max(0.01f, edge.Weight)), 0.5f, 3f)
        : 1f;

      Vector3 force =
        direction *
        (safeSpringStrength * weightScale * extension);

      a.Force += force;
      b.Force -= force;
    }
  }

  private void ApplyAnchors()
  {
    float safeComponentGravity = Mathf.Max(0f, componentGravityStrength);
    float safeTagAnchor = Mathf.Max(0f, tagAnchorStrength);

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      var node = _nodes[nodeIndex];

      if (safeComponentGravity > 0f)
        node.Force += (node.ComponentCenter - node.Position) * safeComponentGravity;

      if (!node.IsNote && safeTagAnchor > 0f)
        node.Force += (node.InitialPosition - node.Position) * safeTagAnchor;
    }
  }

  private void ResolveResidualOverlaps()
  {
    int safePasses = Mathf.Clamp(overlapCleanupPasses, 0, 16);
    float safeMinimumDistance = Mathf.Max(0.01f, minimumNodeDistance);
    float safeMinimumDistanceSqr = safeMinimumDistance * safeMinimumDistance;
    int safeMaxChecks = Mathf.Max(1, maxOverlapChecksPerNode);

    if (safePasses == 0 || _nodes.Count <= 1)
      return;

    EnsureOverlapBuffers();

    for (int pass = 0; pass < safePasses; pass++)
    {
      Array.Clear(_overlapCorrections, 0, _overlapCorrections.Length);
      Array.Clear(_overlapCorrectionCounts, 0, _overlapCorrectionCounts.Length);

      BuildSpatialGrid(safeMinimumDistance);

      for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
      {
        var node = _nodes[nodeIndex];
        Vector3Int origin = ToCell(node.Position, safeMinimumDistance);
        int checks = 0;

        for (int x = -1; x <= 1 && checks < safeMaxChecks; x++)
          for (int y = -1; y <= 1 && checks < safeMaxChecks; y++)
            for (int z = -1; z <= 1 && checks < safeMaxChecks; z++)
            {
              if (!_grid.TryGetValue(origin + new Vector3Int(x, y, z), out var bucket))
                continue;

              for (int bucketIndex = 0; bucketIndex < bucket.Count && checks < safeMaxChecks; bucketIndex++)
              {
                int otherIndex = bucket[bucketIndex];
                if (otherIndex <= nodeIndex) continue;

                checks++;
                _overlapPairChecks++;

                var other = _nodes[otherIndex];
                Vector3 delta = other.Position - node.Position;
                float distanceSqr = delta.sqrMagnitude;
                if (distanceSqr >= safeMinimumDistanceSqr) continue;

                Vector3 direction;
                float distance;
                if (distanceSqr <= MIN_SQR_DISTANCE)
                {
                  direction = StablePairDirection(nodeIndex, otherIndex, 307);
                  distance = 0f;
                }
                else
                {
                  distance = Mathf.Sqrt(distanceSqr);
                  direction = delta / distance;
                }

                float separation = safeMinimumDistance - distance;
                Vector3 correction = direction * (separation * 0.5f);

                _overlapCorrections[nodeIndex] -= correction;
                _overlapCorrections[otherIndex] += correction;
                _overlapCorrectionCounts[nodeIndex]++;
                _overlapCorrectionCounts[otherIndex]++;
              }
            }
      }

      bool movedAny = false;
      for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
      {
        int correctionCount = _overlapCorrectionCounts[nodeIndex];
        if (correctionCount <= 0) continue;

        Vector3 correction =
          _overlapCorrections[nodeIndex] /
          correctionCount;

        if (correction.sqrMagnitude <= MIN_SQR_DISTANCE)
          continue;

        var node = _nodes[nodeIndex];
        node.Position = ClampToSphere(
          node.Position + correction,
          safeMinimumDistance * 0.5f);

        movedAny = true;
      }

      if (!movedAny)
        break;
    }
  }

  private void EnsureOverlapBuffers()
  {
    if (_overlapCorrections.Length == _nodes.Count &&
        _overlapCorrectionCounts.Length == _nodes.Count)
    {
      return;
    }

    _overlapCorrections = new Vector3[_nodes.Count];
    _overlapCorrectionCounts = new int[_nodes.Count];
  }

  private void BuildSpatialGrid(float cellSize)
  {
    float safeCellSize = Mathf.Max(0.1f, cellSize);
    ResetSpatialGrid();

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      Vector3Int cell = ToCell(_nodes[nodeIndex].Position, safeCellSize);
      GetOrCreateGridBucket(cell).Add(nodeIndex);
    }
  }

  private void ResetSpatialGrid()
  {
    _grid.Clear();
    _usedGridBuckets = 0;
  }

  private List<int> GetOrCreateGridBucket(Vector3Int cell)
  {
    if (_grid.TryGetValue(cell, out var bucket))
      return bucket;

    if (_usedGridBuckets < _gridBucketPool.Count)
    {
      bucket = _gridBucketPool[_usedGridBuckets];
      bucket.Clear();
    }
    else
    {
      bucket = new List<int>(8);
      _gridBucketPool.Add(bucket);
    }

    _usedGridBuckets++;
    _grid[cell] = bucket;
    return bucket;
  }

  private void InstantiateNodes()
  {
    if (starTemplate == null)
    {
      UnityEngine.Debug.LogError("[CartographerSettledForces] Missing starTemplate.");
      return;
    }

    bool canCreateTags = tagNodeTemplate != null;
    if (!canCreateTags && _nodes.Count > _noteCount)
      UnityEngine.Debug.LogWarning("[CartographerSettledForces] Missing tagNodeTemplate. Tag nodes were skipped.");

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      var node = _nodes[nodeIndex];
      Vector3 worldPosition = layoutParent
        ? layoutParent.TransformPoint(node.Position)
        : node.Position;

      if (node.IsNote)
      {
        node.Star = starTemplate.Instantiate(
          worldPosition,
          node.Note,
          layoutParent);

        if (node.Star != null)
          _stars.Add(node.Star);
      }
      else if (canCreateTags)
      {
        node.TagNode = TagNode.Create(
          tagNodeTemplate,
          worldPosition,
          node.TagId,
          layoutParent);

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
      .OrderBy(edge => edge.A)
      .ThenBy(edge => edge.B)
      .ToList();

    int added = 0;
    added += InstantiateLinesFromEdges(
      orderedDirectLinks,
      startIndex: 0,
      maxCount: directBudget);

    added += InstantiateLinesFromEdges(
      orderedTagEdges,
      startIndex: 0,
      maxCount: safeBudget - added);

    if (added < safeBudget)
    {
      added += InstantiateLinesFromEdges(
        orderedDirectLinks,
        startIndex: directBudget,
        maxCount: safeBudget - added);
    }
  }

  private int InstantiateLinesFromEdges(
    List<Edge> edges,
    int startIndex,
    int maxCount)
  {
    int added = 0;
    int safeStart = Mathf.Clamp(startIndex, 0, edges.Count);
    int endExclusive = Mathf.Min(edges.Count, safeStart + Mathf.Max(0, maxCount));

    for (int edgeIndex = safeStart; edgeIndex < endExclusive; edgeIndex++)
    {
      var edge = edges[edgeIndex];
      var a = _nodes[edge.A].VisualTransform;
      var b = _nodes[edge.B].VisualTransform;
      if (!a || !b) continue;

      var line = Instantiate(edgePrefab, layoutParent);
      line.positionCount = 2;
      line.SetPosition(0, a.position);
      line.SetPosition(1, b.position);
      _lines.Add(line);
      added++;
    }

    return added;
  }

  private Vector3 ClampToSphere(Vector3 position, float margin)
  {
    float radius = Mathf.Max(0.01f, _boundRadius - Mathf.Max(0f, margin));
    return position.sqrMagnitude <= radius * radius
      ? position
      : position.normalized * radius;
  }

  private int CompareNodeKeys(int left, int right)
  {
    return string.CompareOrdinal(_nodes[left].Key, _nodes[right].Key);
  }

  private static Vector3Int ToCell(Vector3 position, float cellSize)
  {
    float safeCellSize = Mathf.Max(0.1f, cellSize);
    return new Vector3Int(
      Mathf.FloorToInt(position.x / safeCellSize),
      Mathf.FloorToInt(position.y / safeCellSize),
      Mathf.FloorToInt(position.z / safeCellSize));
  }

  private static Vector3 FibonacciBallPoint(int index, int count)
  {
    if (count <= 1) return Vector3.zero;

    float t = (index + 0.5f) / count;
    float y = 1f - 2f * t;
    float radial = Mathf.Sqrt(Mathf.Max(0f, 1f - y * y));
    float angle = index * GOLDEN_ANGLE_RAD;
    float fill = Mathf.Pow((index + 1f) / count, 1f / 3f);

    return new Vector3(
      Mathf.Cos(angle) * radial,
      y,
      Mathf.Sin(angle) * radial) * fill;
  }

  private static Vector3 FibonacciSpherePoint(int index, int count)
  {
    if (count <= 1) return Vector3.zero;

    float t = (index + 0.5f) / count;
    float y = 1f - 2f * t;
    float radial = Mathf.Sqrt(Mathf.Max(0f, 1f - y * y));
    float angle = index * GOLDEN_ANGLE_RAD;

    return new Vector3(
      Mathf.Cos(angle) * radial,
      y,
      Mathf.Sin(angle) * radial);
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
