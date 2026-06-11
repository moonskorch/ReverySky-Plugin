using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using UnityEngine;

/// <summary>
/// Visual result is not great: it looks like artificially separated pieces with elongated links. No animation.
/// 1. Some maps have a flattened edge along the map boundary.
/// 2. Hubs and large maps end up stuck together.
/// v2 is better in every respect.
/// Overall: inferior to v2.
/// <summary>


/// <summary>
/// Static link-based layout for medium and large note graphs.
///
/// The engine builds a deterministic structural backbone once during BuildGraph():
/// - notes and tags become logical nodes;
/// - diversified high-score roots are placed far apart inside each component;
/// - a best-first frontier grows the map from structurally important nodes outward;
/// - every placed node chooses the best already placed parent for layout purposes;
/// - remaining graph edges stay available as cross-links;
/// - a few bounded spring-only passes gently pull related regions together;
/// - a bounded spatial-hash cleanup resolves residual local overlaps;
/// - visual objects are instantiated only after layout is frozen.
///
/// Runtime Tick() is intentionally empty.
///
/// The first spike intentionally does not use global repulsion, Barnes-Hut,
/// jobs, GPU instancing, progressive rendering, or incremental graph updates.
/// </summary>
[DisallowMultipleComponent]
public class Engine_RecursiveHubs_v1 : MonoBehaviour, ICartographerEngine
{
  [Header("Prefabs & Parents")]
  [SerializeField] private StarSO starTemplate;
  [SerializeField] private Transform layoutParent;
  [SerializeField] private TagNodeSO tagNodeTemplate;
  [SerializeField] private LineRenderer edgePrefab;

  [Header("Dynamic sphere scaling")]
  [Tooltip("Primary map density control. Larger values create a more spacious map.")]
  [SerializeField, Min(0.1f)] private float nodeSpacingFactor = 5.8f;
  [SerializeField, Min(0.1f)] private float minimumBoundRadius = 10f;
  [SerializeField, Range(0.2f, 2f)] private float componentRadiusFactor = 0.92f;
  [SerializeField, Range(0.5f, 3f)] private float componentEnvelopeFactor = 1.35f;
  [SerializeField, Range(0.05f, 0.95f)] private float componentSpreadRatio = 0.78f;

  [Header("Structural score")]
  [Tooltip("Contribution of a direct note-note link to note importance.")]
  [SerializeField, Min(0f)] private float directLinkScoreWeight = 2.2f;
  [Tooltip("Contribution of a note-tag relation to note importance.")]
  [SerializeField, Min(0f)] private float noteTagScoreWeight = 0.7f;
  [Tooltip("Additional low-cost bonus for nodes with several neighbors.")]
  [SerializeField, Min(0f)] private float degreeScoreBonus = 0.45f;
  [Tooltip("Controls how strongly tag frequency affects tag importance.")]
  [SerializeField, Min(0f)] private float tagNodeScoreMultiplier = 1.8f;
  [Tooltip("Caps generic tags so they do not dominate the entire map.")]
  [SerializeField, Min(0.1f)] private float maximumTagHubScore = 9f;

  [Header("Diversified roots")]
  [Tooltip("Maximum number of far-apart structural roots inside one connected component.")]
  [SerializeField, Range(1, 16)] private int maxRootHubsPerComponent = 6;
  [Tooltip("Cube-root factor used to choose the root count from component size.")]
  [SerializeField, Range(0.1f, 2f)] private float rootCountFactor = 0.55f;
  [Tooltip("Selected roots avoid nodes this many graph steps away from an earlier root when possible.")]
  [SerializeField, Range(0, 4)] private int rootExclusionGraphDepth = 1;
  [SerializeField, Range(0.05f, 0.95f)] private float rootSpreadRatio = 0.68f;

  [Header("Recursive placement")]
  [SerializeField, Min(0.1f)] private float minimumNodeDistance = 2.4f;
  [Tooltip("Base parent-child distance for structural nodes with several neighbors.")]
  [SerializeField, Min(0.1f)] private float hubChildDistanceFactor = 2.1f;
  [Tooltip("Base parent-child distance for leaf-like nodes.")]
  [SerializeField, Min(0.1f)] private float leafChildDistanceFactor = 1.25f;
  [Tooltip("Additional reserved space around children with several relations.")]
  [SerializeField, Min(0f)] private float childReservationFactor = 0.72f;
  [Tooltip("Limits reservation growth around extreme hubs.")]
  [SerializeField, Min(0.1f)] private float maximumChildReservation = 12f;
  [Tooltip("Adds wider shells when one parent has many children.")]
  [SerializeField, Min(0f)] private float siblingShellFactor = 0.46f;
  [Tooltip("Nodes with at least this many neighbors use hub-style spacing.")]
  [SerializeField, Range(2, 64)] private int childHubDegreeThreshold = 4;
  [Tooltip("Packing attempts around a preferred hierarchical position.")]
  [SerializeField, Range(8, 256)] private int maxPlacementAttempts = 72;

  [Header("Parent selection")]
  [Tooltip("Direct links are stronger layout evidence than note-tag relations.")]
  [SerializeField, Min(0f)] private float directLinkParentWeight = 3.0f;
  [SerializeField, Min(0f)] private float noteTagParentWeight = 1.0f;
  [Tooltip("Small preference for attaching under a structurally important parent.")]
  [SerializeField, Min(0f)] private float parentScoreInfluence = 0.08f;
  [Tooltip("Spreads large families across alternative placed parents when possible.")]
  [SerializeField, Min(0f)] private float parentCrowdingPenalty = 0.16f;
  [Tooltip("Importance of the target node while growing the best-first frontier.")]
  [SerializeField, Min(0f)] private float frontierTargetScoreWeight = 4.0f;
  [Tooltip("Importance of the relation while growing the best-first frontier.")]
  [SerializeField, Min(0f)] private float frontierRelationWeight = 1.0f;

  [Header("Bounded spring refinement")]
  [Tooltip("Small count by design. This stage refines the structural layout; it does not rebuild it.")]
  [SerializeField, Range(0, 32)] private int springRelaxationPasses = 6;
  [SerializeField, Range(0f, 1f)] private float springPull = 0.11f;
  [SerializeField, Min(0.01f)] private float maxSpringMovePerPass = 0.75f;
  [SerializeField, Min(0.01f)] private float noteTagRestLength = 6.0f;
  [SerializeField, Min(0.01f)] private float directLinkRestLength = 6.5f;
  [SerializeField, Min(0.01f)] private float minimumDirectLinkRestLength = 2.8f;
  [Tooltip("Roots move a little during refinement but preserve the large-scale skeleton.")]
  [SerializeField, Range(0f, 1f)] private float rootMobility = 0.18f;

  [Header("Residual overlap cleanup")]
  [SerializeField, Range(0, 16)] private int overlapCleanupPasses = 2;
  [SerializeField, Range(8, 4096)] private int maxOverlapChecksPerNode = 96;

  [Header("Visual")]
  [SerializeField, Min(0.01f)] private float tagScale = 0.7f;
  [SerializeField, Min(0)] private int maxVisibleEdges = 1500;
  [Tooltip("Backbone lines receive a guaranteed part of the visual budget.")]
  [SerializeField, Range(0f, 1f)] private float backboneBudgetRatio = 0.52f;
  [Tooltip("Strong direct links receive a guaranteed part of the visual budget.")]
  [SerializeField, Range(0f, 1f)] private float directLinkBudgetRatio = 0.32f;

  private const float GOLDEN_ANGLE_RAD = 2.39996323f;
  private const float GOLDEN_RATIO_CONJUGATE = 0.61803398875f;
  private const float MIN_SQR_DISTANCE = 0.000001f;

  private float _boundRadius;
  private int _noteCount;
  private int _rootCount;
  private int _maxHierarchyDepth;
  private int _placementFallbacks;
  private long _overlapPairChecks;
  private long _frontierPushes;
  private long _frontierPops;

  private readonly List<Node> _nodes = new();
  private readonly List<Edge> _tagEdges = new();
  private readonly List<Edge> _noteLinks = new();
  private readonly List<Edge> _allEdges = new();
  private readonly List<Edge> _backboneEdges = new();
  private readonly List<Component> _components = new();
  private readonly List<LineRenderer> _lines = new();
  private readonly List<Star> _stars = new();

  private List<Neighbor>[] _adjacency = Array.Empty<List<Neighbor>>();

  private readonly HashSet<Vector3Int> _placementCells = new();
  private List<Vector3Int> _packingOffsets = new();

  private readonly Dictionary<Vector3Int, List<int>> _overlapGrid = new();
  private readonly List<List<int>> _overlapBucketPool = new();
  private int _usedOverlapBuckets;

  private Vector3[] _layoutCorrections = Array.Empty<Vector3>();
  private int[] _layoutCorrectionCounts = Array.Empty<int>();

  private sealed class Node
  {
    public bool IsNote;
    public NoteData Note;
    public int TagId;
    public int TagFrequency;
    public string Key;

    public float StructuralScore;
    public Vector3 LocalPosition;

    public bool IsPlaced;
    public bool IsRoot;
    public int LayoutParent = -1;
    public int HierarchyDepth;
    public int AssignedChildCount;
    public int ComponentIndex = -1;

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
    public readonly List<int> Roots = new();
    public string Key;
    public Vector3 Center;
    public float Radius;
  }

  private readonly struct PlacementProposal
  {
    public readonly int From;
    public readonly int To;
    public readonly float Priority;
    public readonly long Sequence;

    public PlacementProposal(int from, int to, float priority, long sequence)
    {
      From = from;
      To = to;
      Priority = priority;
      Sequence = sequence;
    }
  }

  private sealed class ProposalMaxHeap
  {
    private readonly List<PlacementProposal> _items = new();

    public int Count => _items.Count;

    public void Clear()
    {
      _items.Clear();
    }

    public void Push(PlacementProposal item)
    {
      _items.Add(item);
      int index = _items.Count - 1;

      while (index > 0)
      {
        int parent = (index - 1) / 2;
        if (!ComesBefore(_items[index], _items[parent]))
          break;

        (_items[index], _items[parent]) = (_items[parent], _items[index]);
        index = parent;
      }
    }

    public PlacementProposal Pop()
    {
      var result = _items[0];
      int lastIndex = _items.Count - 1;
      _items[0] = _items[lastIndex];
      _items.RemoveAt(lastIndex);

      int index = 0;
      while (true)
      {
        int left = index * 2 + 1;
        int right = left + 1;
        int best = index;

        if (left < _items.Count && ComesBefore(_items[left], _items[best]))
          best = left;
        if (right < _items.Count && ComesBefore(_items[right], _items[best]))
          best = right;
        if (best == index)
          break;

        (_items[index], _items[best]) = (_items[best], _items[index]);
        index = best;
      }

      return result;
    }

    private static bool ComesBefore(PlacementProposal left, PlacementProposal right)
    {
      int priorityOrder = left.Priority.CompareTo(right.Priority);
      if (priorityOrder != 0)
        return priorityOrder > 0;

      return left.Sequence < right.Sequence;
    }
  }

  private readonly ProposalMaxHeap _frontier = new();
  private long _nextProposalSequence;

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
    // The structural layout is intentionally frozen after BuildGraph().
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

    var adjacencyStopwatch = Stopwatch.StartNew();
    BuildAdjacencyAndScores();
    adjacencyStopwatch.Stop();

    var componentsStopwatch = Stopwatch.StartNew();
    FindConnectedComponents();
    CalculateComponentGeometry();
    componentsStopwatch.Stop();

    if (_noteCount == 0)
    {
      totalStopwatch.Stop();
      UnityEngine.Debug.Log(
        $"[RecursiveHubs] Built empty graph in {totalStopwatch.Elapsed.TotalMilliseconds:F1} ms. " +
        $"ClearGraphMs={clearStopwatch.Elapsed.TotalMilliseconds:F1}, " +
        $"BuildLogicalGraphMs={logicalStopwatch.Elapsed.TotalMilliseconds:F1}, " +
        $"BuildAdjacencyAndScoresMs={adjacencyStopwatch.Elapsed.TotalMilliseconds:F1}");
      return;
    }

    var placementStopwatch = Stopwatch.StartNew();
    PlaceStructuralHierarchy();
    placementStopwatch.Stop();

    var springStopwatch = Stopwatch.StartNew();
    RelaxCrossLinks();
    springStopwatch.Stop();

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
      $"[RecursiveHubs] Built notes={_noteCount}, tags={_nodes.Count - _noteCount}, " +
      $"tagEdges={_tagEdges.Count}, noteLinks={_noteLinks.Count}, components={_components.Count}, " +
      $"roots={_rootCount}, backboneEdges={_backboneEdges.Count}, maxHierarchyDepth={_maxHierarchyDepth}, " +
      $"placementFallbacks={_placementFallbacks}, frontierPushes={_frontierPushes}, frontierPops={_frontierPops}, " +
      $"springPasses={Mathf.Clamp(springRelaxationPasses, 0, 32)}, overlapChecks={_overlapPairChecks}, " +
      $"visibleEdges={_lines.Count}, boundRadius={_boundRadius:F1}, totalMs={totalStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"ClearGraphMs={clearStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"BuildLogicalGraphMs={logicalStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"BuildAdjacencyAndScoresMs={adjacencyStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"FindComponentsAndGeometryMs={componentsStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"PlaceStructuralHierarchyMs={placementStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"RelaxCrossLinksMs={springStopwatch.Elapsed.TotalMilliseconds:F1}, " +
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
      var visualTransform = _nodes[i].VisualTransform;
      if (visualTransform) Destroy(visualTransform.gameObject);
    }

    _nodes.Clear();
    _tagEdges.Clear();
    _noteLinks.Clear();
    _allEdges.Clear();
    _backboneEdges.Clear();
    _components.Clear();
    _stars.Clear();

    _adjacency = Array.Empty<List<Neighbor>>();
    _placementCells.Clear();
    _packingOffsets.Clear();
    _frontier.Clear();
    ResetOverlapGrid();

    _layoutCorrections = Array.Empty<Vector3>();
    _layoutCorrectionCounts = Array.Empty<int>();

    _noteCount = 0;
    _rootCount = 0;
    _maxHierarchyDepth = 0;
    _placementFallbacks = 0;
    _overlapPairChecks = 0;
    _frontierPushes = 0;
    _frontierPops = 0;
    _nextProposalSequence = 0;
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
    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
      _adjacency[nodeIndex] = new List<Neighbor>();

    for (int edgeIndex = 0; edgeIndex < _allEdges.Count; edgeIndex++)
    {
      var edge = _allEdges[edgeIndex];
      _adjacency[edge.A].Add(new Neighbor(edge.B, edge.Weight, edge.Kind));
      _adjacency[edge.B].Add(new Neighbor(edge.A, edge.Weight, edge.Kind));
    }

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      _adjacency[nodeIndex].Sort((left, right) =>
      {
        int keyOrder = string.CompareOrdinal(
          _nodes[left.NodeIndex].Key,
          _nodes[right.NodeIndex].Key);

        if (keyOrder != 0)
          return keyOrder;

        int kindOrder = left.Kind.CompareTo(right.Kind);
        if (kindOrder != 0)
          return kindOrder;

        return right.Weight.CompareTo(left.Weight);
      });
    }

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
      _nodes[nodeIndex].StructuralScore = CalculateStructuralScore(nodeIndex);
  }

  private float CalculateStructuralScore(int nodeIndex)
  {
    var node = _nodes[nodeIndex];
    var neighbors = _adjacency[nodeIndex];

    if (!node.IsNote)
    {
      float frequency = Mathf.Max(1, node.TagFrequency);
      float rawTagScore =
        Mathf.Max(0f, tagNodeScoreMultiplier) *
        Mathf.Log(1f + frequency) +
        Mathf.Max(0f, degreeScoreBonus) *
        Mathf.Sqrt(neighbors.Count);

      return Mathf.Min(
        Mathf.Max(0.1f, maximumTagHubScore),
        Mathf.Max(0.1f, rawTagScore));
    }

    float score = 1f;

    for (int i = 0; i < neighbors.Count; i++)
    {
      var neighbor = neighbors[i];
      score += neighbor.Kind == EdgeKind.DirectNoteLink
        ? Mathf.Max(0f, directLinkScoreWeight) * Mathf.Sqrt(Mathf.Max(0.01f, neighbor.Weight))
        : Mathf.Max(0f, noteTagScoreWeight);
    }

    score += Mathf.Max(0f, degreeScoreBonus) * Mathf.Sqrt(neighbors.Count);
    return Mathf.Max(0.1f, score);
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

        var neighbors = _adjacency[nodeIndex];
        for (int i = 0; i < neighbors.Count; i++)
        {
          int neighborIndex = neighbors[i].NodeIndex;
          if (visited[neighborIndex]) continue;

          visited[neighborIndex] = true;
          queue.Enqueue(neighborIndex);
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
      for (int i = 0; i < component.Nodes.Count; i++)
        _nodes[component.Nodes[i]].ComponentIndex = componentIndex;
    }
  }

  private void CalculateComponentGeometry()
  {
    _boundRadius = CalculateBoundRadius(
      _nodes.Count,
      nodeSpacingFactor,
      minimumBoundRadius);

    if (_components.Count == 0)
      return;

    float safeMinimumDistance = Mathf.Max(0.1f, minimumNodeDistance);
    float safeSpacingFactor = Mathf.Max(0.1f, nodeSpacingFactor);
    float volumeAccumulator = 0f;
    float largestRadius = 0f;

    for (int componentIndex = 0; componentIndex < _components.Count; componentIndex++)
    {
      var component = _components[componentIndex];
      component.Radius = Mathf.Max(
        safeMinimumDistance * 2f,
        safeSpacingFactor *
        Mathf.Pow(Mathf.Max(1, component.Nodes.Count), 1f / 3f) *
        Mathf.Max(0.2f, componentRadiusFactor));

      float envelopeRadius = component.Radius + safeMinimumDistance;
      volumeAccumulator += envelopeRadius * envelopeRadius * envelopeRadius;
      largestRadius = Mathf.Max(largestRadius, component.Radius);
    }

    float envelopeBound =
      Mathf.Pow(Mathf.Max(0f, volumeAccumulator), 1f / 3f) *
      Mathf.Max(0.5f, componentEnvelopeFactor);

    _boundRadius = Mathf.Max(
      _boundRadius,
      Mathf.Max(
        largestRadius + safeMinimumDistance,
        envelopeBound));

    _components[0].Center = Vector3.zero;

    for (int componentIndex = 1; componentIndex < _components.Count; componentIndex++)
    {
      var component = _components[componentIndex];
      float availableDistance = Mathf.Max(
        0f,
        _boundRadius - component.Radius - safeMinimumDistance * 0.5f);

      float minimumCoreSeparation = Mathf.Min(
        availableDistance,
        _components[0].Radius + component.Radius + safeMinimumDistance);

      float fill = Mathf.Pow(
        (float)componentIndex / Mathf.Max(1, _components.Count - 1),
        1f / 3f);

      float desiredDistance = Mathf.Lerp(
        minimumCoreSeparation,
        availableDistance,
        Mathf.Clamp01(fill * Mathf.Clamp01(componentSpreadRatio)));

      component.Center =
        FibonacciSpherePoint(componentIndex - 1, _components.Count - 1) *
        desiredDistance;
    }
  }

  private void PlaceStructuralHierarchy()
  {
    _placementCells.Clear();
    _packingOffsets = BuildPackingOffsets(Mathf.Clamp(maxPlacementAttempts, 8, 256));

    for (int componentIndex = 0; componentIndex < _components.Count; componentIndex++)
      PlaceComponent(componentIndex);
  }

  private void PlaceComponent(int componentIndex)
  {
    var component = _components[componentIndex];
    var roots = SelectDiversifiedRoots(component);
    _frontier.Clear();

    for (int rootOffset = 0; rootOffset < roots.Count; rootOffset++)
    {
      int rootIndex = roots[rootOffset];
      Vector3 preferredPosition;

      if (rootOffset == 0)
      {
        preferredPosition = component.Center;
      }
      else
      {
        float rootDistance =
          component.Radius *
          Mathf.Clamp(rootSpreadRatio, 0.05f, 0.95f);

        preferredPosition =
          component.Center +
          FibonacciSpherePoint(rootOffset - 1, roots.Count - 1) *
          rootDistance;
      }

      Vector3 position = FindFreePosition(
        preferredPosition,
        _nodes[rootIndex].Key,
        101 + rootOffset);

      MarkPlacedRoot(rootIndex, position);
      component.Roots.Add(rootIndex);
      EnqueueProposalsFrom(rootIndex);
    }

    int placedCount = roots.Count;

    while (placedCount < component.Nodes.Count)
    {
      bool placedFromFrontier = false;

      while (_frontier.Count > 0)
      {
        PlacementProposal proposal = _frontier.Pop();
        _frontierPops++;

        int targetIndex = proposal.To;
        if (_nodes[targetIndex].IsPlaced)
          continue;

        if (_nodes[targetIndex].ComponentIndex != componentIndex)
          continue;

        if (!TryFindBestPlacedParent(targetIndex, componentIndex, out int parentIndex, out Edge relation))
          continue;

        Vector3 preferredPosition = CalculatePreferredChildPosition(parentIndex, targetIndex, relation);
        Vector3 position = FindFreePosition(
          preferredPosition,
          _nodes[targetIndex].Key,
          211 + _nodes[parentIndex].AssignedChildCount);

        MarkPlacedChild(targetIndex, parentIndex, position);
        _backboneEdges.Add(relation);

        EnqueueProposalsFrom(targetIndex);
        placedCount++;
        placedFromFrontier = true;
        break;
      }

      if (placedFromFrontier)
        continue;

      int fallbackRoot = FindHighestPriorityUnplacedNode(component.Nodes);
      if (fallbackRoot < 0)
        break;

      Vector3 fallbackPreferred =
        component.Center +
        FibonacciBallPoint(placedCount, component.Nodes.Count) *
        component.Radius;

      Vector3 fallbackPosition = FindFreePosition(
        fallbackPreferred,
        _nodes[fallbackRoot].Key,
        307 + placedCount);

      MarkPlacedRoot(fallbackRoot, fallbackPosition);
      component.Roots.Add(fallbackRoot);
      EnqueueProposalsFrom(fallbackRoot);
      placedCount++;
    }
  }

  private List<int> SelectDiversifiedRoots(Component component)
  {
    var orderedCandidates = component.Nodes
      .OrderByDescending(nodeIndex => _nodes[nodeIndex].StructuralScore)
      .ThenByDescending(nodeIndex => _nodes[nodeIndex].IsNote)
      .ThenBy(nodeIndex => _nodes[nodeIndex].Key, StringComparer.Ordinal)
      .ToList();

    int desiredRootCount = Mathf.Clamp(
      Mathf.CeilToInt(
        Mathf.Pow(Mathf.Max(1, component.Nodes.Count), 1f / 3f) *
        Mathf.Max(0.1f, rootCountFactor)),
      1,
      Mathf.Max(1, maxRootHubsPerComponent));

    desiredRootCount = Mathf.Min(desiredRootCount, component.Nodes.Count);

    var roots = new List<int>(desiredRootCount);
    var selected = new bool[_nodes.Count];
    var excluded = new bool[_nodes.Count];

    int[] visitMarks = new int[_nodes.Count];
    int[] visitDepths = new int[_nodes.Count];
    int marker = 0;

    for (int candidateOffset = 0;
         candidateOffset < orderedCandidates.Count && roots.Count < desiredRootCount;
         candidateOffset++)
    {
      int candidate = orderedCandidates[candidateOffset];
      if (selected[candidate] || excluded[candidate])
        continue;

      roots.Add(candidate);
      selected[candidate] = true;

      MarkExcludedNearRoot(
        candidate,
        Mathf.Clamp(rootExclusionGraphDepth, 0, 4),
        excluded,
        visitMarks,
        visitDepths,
        ref marker);
    }

    for (int candidateOffset = 0;
         candidateOffset < orderedCandidates.Count && roots.Count < desiredRootCount;
         candidateOffset++)
    {
      int candidate = orderedCandidates[candidateOffset];
      if (selected[candidate])
        continue;

      roots.Add(candidate);
      selected[candidate] = true;
    }

    return roots;
  }

  private void MarkExcludedNearRoot(
    int rootIndex,
    int maxDepth,
    bool[] excluded,
    int[] visitMarks,
    int[] visitDepths,
    ref int marker)
  {
    marker++;
    if (marker == int.MaxValue)
    {
      Array.Clear(visitMarks, 0, visitMarks.Length);
      marker = 1;
    }

    var queue = new Queue<int>();
    visitMarks[rootIndex] = marker;
    visitDepths[rootIndex] = 0;
    queue.Enqueue(rootIndex);

    while (queue.Count > 0)
    {
      int nodeIndex = queue.Dequeue();
      int depth = visitDepths[nodeIndex];
      excluded[nodeIndex] = true;

      if (depth >= maxDepth)
        continue;

      var neighbors = _adjacency[nodeIndex];
      for (int i = 0; i < neighbors.Count; i++)
      {
        int neighborIndex = neighbors[i].NodeIndex;
        if (visitMarks[neighborIndex] == marker)
          continue;

        visitMarks[neighborIndex] = marker;
        visitDepths[neighborIndex] = depth + 1;
        queue.Enqueue(neighborIndex);
      }
    }
  }

  private void MarkPlacedRoot(int nodeIndex, Vector3 position)
  {
    var node = _nodes[nodeIndex];
    node.IsPlaced = true;
    node.IsRoot = true;
    node.LayoutParent = -1;
    node.HierarchyDepth = 0;
    node.LocalPosition = position;

    _rootCount++;
  }

  private void MarkPlacedChild(int nodeIndex, int parentIndex, Vector3 position)
  {
    var node = _nodes[nodeIndex];
    var parent = _nodes[parentIndex];

    node.IsPlaced = true;
    node.IsRoot = false;
    node.LayoutParent = parentIndex;
    node.HierarchyDepth = parent.HierarchyDepth + 1;
    node.LocalPosition = position;

    parent.AssignedChildCount++;
    _maxHierarchyDepth = Mathf.Max(_maxHierarchyDepth, node.HierarchyDepth);
  }

  private void EnqueueProposalsFrom(int sourceIndex)
  {
    var source = _nodes[sourceIndex];
    var neighbors = _adjacency[sourceIndex];

    for (int neighborOffset = 0; neighborOffset < neighbors.Count; neighborOffset++)
    {
      var relation = neighbors[neighborOffset];
      int targetIndex = relation.NodeIndex;

      if (_nodes[targetIndex].IsPlaced)
        continue;

      float priority =
        _nodes[targetIndex].StructuralScore *
        Mathf.Max(0f, frontierTargetScoreWeight) +
        RelationStrength(relation.Kind, relation.Weight) *
        Mathf.Max(0f, frontierRelationWeight) +
        source.StructuralScore * 0.02f;

      _frontier.Push(
        new PlacementProposal(
          sourceIndex,
          targetIndex,
          priority,
          _nextProposalSequence++));

      _frontierPushes++;
    }
  }

  private bool TryFindBestPlacedParent(
    int targetIndex,
    int componentIndex,
    out int parentIndex,
    out Edge selectedRelation)
  {
    parentIndex = -1;
    selectedRelation = default;

    float bestScore = float.NegativeInfinity;
    string bestKey = null;

    var neighbors = _adjacency[targetIndex];
    for (int neighborOffset = 0; neighborOffset < neighbors.Count; neighborOffset++)
    {
      var relation = neighbors[neighborOffset];
      int candidateParentIndex = relation.NodeIndex;
      var candidateParent = _nodes[candidateParentIndex];

      if (!candidateParent.IsPlaced ||
          candidateParent.ComponentIndex != componentIndex)
      {
        continue;
      }

      float score =
        RelationStrength(relation.Kind, relation.Weight) +
        candidateParent.StructuralScore * Mathf.Max(0f, parentScoreInfluence) -
        candidateParent.AssignedChildCount * Mathf.Max(0f, parentCrowdingPenalty);

      string candidateKey = candidateParent.Key ?? string.Empty;
      bool isBetter =
        score > bestScore + 0.0001f ||
        (Mathf.Abs(score - bestScore) <= 0.0001f &&
         string.CompareOrdinal(candidateKey, bestKey) < 0);

      if (!isBetter)
        continue;

      bestScore = score;
      bestKey = candidateKey;
      parentIndex = candidateParentIndex;
      selectedRelation = new Edge(
        candidateParentIndex,
        targetIndex,
        relation.Weight,
        relation.Kind);
    }

    return parentIndex >= 0;
  }

  private float RelationStrength(EdgeKind kind, float weight)
  {
    return kind == EdgeKind.DirectNoteLink
      ? Mathf.Max(0f, directLinkParentWeight) * Mathf.Sqrt(Mathf.Max(0.01f, weight))
      : Mathf.Max(0f, noteTagParentWeight);
  }

  private Vector3 CalculatePreferredChildPosition(
    int parentIndex,
    int childIndex,
    Edge relation)
  {
    var parent = _nodes[parentIndex];
    var child = _nodes[childIndex];

    bool isHubLike =
      _adjacency[childIndex].Count >=
      Mathf.Max(2, childHubDegreeThreshold);

    float safeMinimumDistance = Mathf.Max(0.1f, minimumNodeDistance);

    float baseDistance =
      safeMinimumDistance *
      (isHubLike
        ? Mathf.Max(0.1f, hubChildDistanceFactor)
        : Mathf.Max(0.1f, leafChildDistanceFactor));

    float reservation =
      safeMinimumDistance *
      Mathf.Max(0f, childReservationFactor) *
      Mathf.Pow(Mathf.Max(1, _adjacency[childIndex].Count), 1f / 3f);

    reservation = Mathf.Min(
      Mathf.Max(0.1f, maximumChildReservation),
      reservation);

    float siblingShell =
      safeMinimumDistance *
      Mathf.Max(0f, siblingShellFactor) *
      Mathf.Pow(parent.AssignedChildCount + 1f, 1f / 3f);

    float relationCompression = relation.Kind == EdgeKind.DirectNoteLink
      ? Mathf.Clamp(Mathf.Sqrt(Mathf.Max(0.01f, relation.Weight)), 0.85f, 1.6f)
      : 1f;

    float distance =
      (baseDistance + reservation + siblingShell) /
      relationCompression;

    Vector3 slotDirection =
      GoldenSphereDirection(parent.AssignedChildCount);

    Quaternion parentRotation = Quaternion.FromToRotation(
      Vector3.up,
      StableDirection(parent.Key, 401));

    Vector3 direction =
      parentRotation * slotDirection +
      StableDirection(child.Key, 409) * 0.18f;

    if (direction.sqrMagnitude <= MIN_SQR_DISTANCE)
      direction = StableDirection(child.Key, 419);

    return parent.LocalPosition + direction.normalized * distance;
  }

  private int FindHighestPriorityUnplacedNode(List<int> nodeIndices)
  {
    int bestIndex = -1;

    for (int i = 0; i < nodeIndices.Count; i++)
    {
      int nodeIndex = nodeIndices[i];
      if (_nodes[nodeIndex].IsPlaced)
        continue;

      if (bestIndex < 0 || CompareNodePriority(nodeIndex, bestIndex) < 0)
        bestIndex = nodeIndex;
    }

    return bestIndex;
  }

  private Vector3 FindFreePosition(
    Vector3 preferredPosition,
    string nodeKey,
    int salt)
  {
    float safeCellSize = Mathf.Max(0.1f, minimumNodeDistance);
    Vector3 target = ClampToSphere(preferredPosition, safeCellSize * 0.5f);
    Vector3Int origin = ToCell(target, safeCellSize);

    int offsetCount = _packingOffsets.Count;
    int shift = offsetCount > 1
      ? (int)(StableHash(nodeKey, salt) % (uint)(offsetCount - 1))
      : 0;

    for (int attempt = 0; attempt < offsetCount; attempt++)
    {
      Vector3Int offset = attempt == 0
        ? Vector3Int.zero
        : _packingOffsets[1 + ((attempt - 1 + shift) % (offsetCount - 1))];

      Vector3Int candidateCell = origin + offset;
      if (_placementCells.Contains(candidateCell))
        continue;

      Vector3 candidateCenter = CellCenter(candidateCell, safeCellSize);
      if (!IsInsideSphere(candidateCenter, safeCellSize * 0.5f))
        continue;

      Vector3 organicOffset =
        StableDirection(nodeKey, salt + 37) *
        safeCellSize *
        0.18f;

      Vector3 candidatePosition = ClampToSphere(
        candidateCenter + organicOffset,
        safeCellSize * 0.35f);

      Vector3Int finalCell = ToCell(candidatePosition, safeCellSize);
      if (_placementCells.Contains(finalCell))
        continue;

      _placementCells.Add(finalCell);
      return candidatePosition;
    }

    _placementFallbacks++;

    Vector3 fallbackPosition = ClampToSphere(
      target + StableDirection(nodeKey, salt + 71) * safeCellSize * 0.25f,
      safeCellSize * 0.35f);

    _placementCells.Add(ToCell(fallbackPosition, safeCellSize));
    return fallbackPosition;
  }

  private void RelaxCrossLinks()
  {
    int safePassCount = Mathf.Clamp(springRelaxationPasses, 0, 32);
    if (safePassCount == 0 || _nodes.Count <= 1 || _allEdges.Count == 0)
      return;

    EnsureCorrectionBuffers();

    float safeSpringPull = Mathf.Clamp01(springPull);
    float safeMaxMove = Mathf.Max(0.01f, maxSpringMovePerPass);

    for (int pass = 0; pass < safePassCount; pass++)
    {
      Array.Clear(_layoutCorrections, 0, _layoutCorrections.Length);
      Array.Clear(_layoutCorrectionCounts, 0, _layoutCorrectionCounts.Length);

      for (int edgeIndex = 0; edgeIndex < _allEdges.Count; edgeIndex++)
      {
        var edge = _allEdges[edgeIndex];
        var a = _nodes[edge.A];
        var b = _nodes[edge.B];

        Vector3 delta = b.LocalPosition - a.LocalPosition;
        float distanceSqr = delta.sqrMagnitude;
        if (distanceSqr <= MIN_SQR_DISTANCE)
          continue;

        float distance = Mathf.Sqrt(distanceSqr);
        float restLength = ResolveRestLength(edge);
        float extension = distance - restLength;

        // Pull long cross-links together, but keep deliberately reserved space.
        if (extension <= 0f)
          continue;

        float weightScale = edge.Kind == EdgeKind.DirectNoteLink
          ? Mathf.Clamp(Mathf.Sqrt(Mathf.Max(0.01f, edge.Weight)), 0.5f, 3f)
          : 1f;

        float move = Mathf.Min(
          safeMaxMove,
          extension * safeSpringPull * weightScale);

        Vector3 correction = delta / distance * (move * 0.5f);

        _layoutCorrections[edge.A] += correction * NodeMobility(a);
        _layoutCorrections[edge.B] -= correction * NodeMobility(b);
        _layoutCorrectionCounts[edge.A]++;
        _layoutCorrectionCounts[edge.B]++;
      }

      bool movedAny = false;

      for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
      {
        int correctionCount = _layoutCorrectionCounts[nodeIndex];
        if (correctionCount <= 0)
          continue;

        Vector3 correction =
          _layoutCorrections[nodeIndex] /
          correctionCount;

        if (correction.sqrMagnitude <= MIN_SQR_DISTANCE)
          continue;

        _nodes[nodeIndex].LocalPosition = ClampToSphere(
          _nodes[nodeIndex].LocalPosition + correction,
          Mathf.Max(0.1f, minimumNodeDistance) * 0.35f);

        movedAny = true;
      }

      if (!movedAny)
        break;
    }
  }

  private float ResolveRestLength(Edge edge)
  {
    if (edge.Kind == EdgeKind.NoteTag)
      return Mathf.Max(0.01f, noteTagRestLength);

    return Mathf.Clamp(
      Mathf.Max(0.01f, directLinkRestLength) /
      Mathf.Sqrt(Mathf.Max(0.01f, edge.Weight)),
      Mathf.Max(0.01f, minimumDirectLinkRestLength),
      Mathf.Max(0.01f, directLinkRestLength) * 1.5f);
  }

  private float NodeMobility(Node node)
  {
    return node.IsRoot
      ? Mathf.Clamp01(rootMobility)
      : 1f;
  }

  private void ResolveResidualOverlaps()
  {
    int safePasses = Mathf.Clamp(overlapCleanupPasses, 0, 16);
    float safeMinimumDistance = Mathf.Max(0.01f, minimumNodeDistance);
    float safeMinimumDistanceSqr = safeMinimumDistance * safeMinimumDistance;
    int safeMaxChecks = Mathf.Max(1, maxOverlapChecksPerNode);

    if (safePasses == 0 || _nodes.Count <= 1)
      return;

    EnsureCorrectionBuffers();

    for (int pass = 0; pass < safePasses; pass++)
    {
      Array.Clear(_layoutCorrections, 0, _layoutCorrections.Length);
      Array.Clear(_layoutCorrectionCounts, 0, _layoutCorrectionCounts.Length);

      BuildOverlapGrid(safeMinimumDistance);

      for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
      {
        var node = _nodes[nodeIndex];
        Vector3Int origin = ToOverlapCell(node.LocalPosition, safeMinimumDistance);
        int checks = 0;

        for (int x = -1; x <= 1 && checks < safeMaxChecks; x++)
          for (int y = -1; y <= 1 && checks < safeMaxChecks; y++)
            for (int z = -1; z <= 1 && checks < safeMaxChecks; z++)
            {
              if (!_overlapGrid.TryGetValue(origin + new Vector3Int(x, y, z), out var bucket))
                continue;

              for (int bucketOffset = 0;
                   bucketOffset < bucket.Count && checks < safeMaxChecks;
                   bucketOffset++)
              {
                int otherIndex = bucket[bucketOffset];
                if (otherIndex <= nodeIndex)
                  continue;

                checks++;
                _overlapPairChecks++;

                var other = _nodes[otherIndex];
                Vector3 delta = other.LocalPosition - node.LocalPosition;
                float distanceSqr = delta.sqrMagnitude;

                if (distanceSqr >= safeMinimumDistanceSqr)
                  continue;

                Vector3 direction;
                float distance;

                if (distanceSqr <= MIN_SQR_DISTANCE)
                {
                  direction = StablePairDirection(nodeIndex, otherIndex, 503);
                  distance = 0f;
                }
                else
                {
                  distance = Mathf.Sqrt(distanceSqr);
                  direction = delta / distance;
                }

                float separation = safeMinimumDistance - distance;
                Vector3 correction = direction * (separation * 0.5f);

                _layoutCorrections[nodeIndex] -= correction * NodeMobility(node);
                _layoutCorrections[otherIndex] += correction * NodeMobility(other);
                _layoutCorrectionCounts[nodeIndex]++;
                _layoutCorrectionCounts[otherIndex]++;
              }
            }
      }

      bool movedAny = false;

      for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
      {
        int correctionCount = _layoutCorrectionCounts[nodeIndex];
        if (correctionCount <= 0)
          continue;

        Vector3 correction =
          _layoutCorrections[nodeIndex] /
          correctionCount;

        if (correction.sqrMagnitude <= MIN_SQR_DISTANCE)
          continue;

        _nodes[nodeIndex].LocalPosition = ClampToSphere(
          _nodes[nodeIndex].LocalPosition + correction,
          safeMinimumDistance * 0.35f);

        movedAny = true;
      }

      if (!movedAny)
        break;
    }
  }

  private void EnsureCorrectionBuffers()
  {
    if (_layoutCorrections.Length == _nodes.Count &&
        _layoutCorrectionCounts.Length == _nodes.Count)
    {
      return;
    }

    _layoutCorrections = new Vector3[_nodes.Count];
    _layoutCorrectionCounts = new int[_nodes.Count];
  }

  private void BuildOverlapGrid(float cellSize)
  {
    float safeCellSize = Mathf.Max(0.1f, cellSize);
    ResetOverlapGrid();

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      Vector3Int cell = ToOverlapCell(
        _nodes[nodeIndex].LocalPosition,
        safeCellSize);

      GetOrCreateOverlapBucket(cell).Add(nodeIndex);
    }
  }

  private void ResetOverlapGrid()
  {
    _overlapGrid.Clear();
    _usedOverlapBuckets = 0;
  }

  private List<int> GetOrCreateOverlapBucket(Vector3Int cell)
  {
    if (_overlapGrid.TryGetValue(cell, out var bucket))
      return bucket;

    if (_usedOverlapBuckets < _overlapBucketPool.Count)
    {
      bucket = _overlapBucketPool[_usedOverlapBuckets];
      bucket.Clear();
    }
    else
    {
      bucket = new List<int>(8);
      _overlapBucketPool.Add(bucket);
    }

    _usedOverlapBuckets++;
    _overlapGrid[cell] = bucket;
    return bucket;
  }

  private void InstantiateNodes()
  {
    if (starTemplate == null)
    {
      UnityEngine.Debug.LogError("[RecursiveHubs] Missing starTemplate.");
      return;
    }

    bool canCreateTags = tagNodeTemplate != null;
    if (!canCreateTags && _nodes.Count > _noteCount)
      UnityEngine.Debug.LogWarning("[RecursiveHubs] Missing tagNodeTemplate. Tag nodes were skipped.");

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      var node = _nodes[nodeIndex];
      Vector3 worldPosition = layoutParent
        ? layoutParent.TransformPoint(node.LocalPosition)
        : node.LocalPosition;

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
    int backboneBudget = Mathf.Clamp(
      Mathf.RoundToInt(safeBudget * Mathf.Clamp01(backboneBudgetRatio)),
      0,
      safeBudget);

    int directBudget = Mathf.Clamp(
      Mathf.RoundToInt(safeBudget * Mathf.Clamp01(directLinkBudgetRatio)),
      0,
      safeBudget - backboneBudget);

    var orderedBackbone = _backboneEdges
      .OrderBy(edge => Mathf.Min(
        _nodes[edge.A].HierarchyDepth,
        _nodes[edge.B].HierarchyDepth))
      .ThenByDescending(edge => Mathf.Max(
        _nodes[edge.A].StructuralScore,
        _nodes[edge.B].StructuralScore))
      .ThenBy(edge => edge.A)
      .ThenBy(edge => edge.B)
      .ToList();

    var orderedDirectLinks = _noteLinks
      .OrderByDescending(edge => edge.Weight)
      .ThenBy(edge => edge.A)
      .ThenBy(edge => edge.B)
      .ToList();

    var orderedTagEdges = _tagEdges
      .OrderBy(edge => edge.A)
      .ThenBy(edge => edge.B)
      .ToList();

    var instantiatedPairs = new HashSet<long>();
    int added = 0;

    added += InstantiateLinesFromEdges(
      orderedBackbone,
      backboneBudget,
      instantiatedPairs);

    added += InstantiateLinesFromEdges(
      orderedDirectLinks,
      Mathf.Min(directBudget, safeBudget - added),
      instantiatedPairs);

    added += InstantiateLinesFromEdges(
      orderedTagEdges,
      safeBudget - added,
      instantiatedPairs);

    if (added < safeBudget)
    {
      added += InstantiateLinesFromEdges(
        orderedDirectLinks,
        safeBudget - added,
        instantiatedPairs);
    }

    if (added < safeBudget)
    {
      InstantiateLinesFromEdges(
        orderedBackbone,
        safeBudget - added,
        instantiatedPairs);
    }
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
    return string.CompareOrdinal(
      _nodes[left].Key,
      _nodes[right].Key);
  }

  private int CompareNodePriority(int left, int right)
  {
    int scoreOrder =
      _nodes[right].StructuralScore.CompareTo(
        _nodes[left].StructuralScore);

    if (scoreOrder != 0)
      return scoreOrder;

    if (_nodes[left].IsNote != _nodes[right].IsNote)
      return _nodes[left].IsNote ? -1 : 1;

    return CompareNodeKeys(left, right);
  }

  private Vector3 ClampToSphere(Vector3 position, float margin)
  {
    float radius =
      Mathf.Max(
        0.01f,
        _boundRadius - Mathf.Max(0f, margin));

    return position.sqrMagnitude <= radius * radius
      ? position
      : position.normalized * radius;
  }

  private bool IsInsideSphere(Vector3 position, float margin)
  {
    float radius =
      Mathf.Max(
        0.01f,
        _boundRadius - Mathf.Max(0f, margin));

    return position.sqrMagnitude <= radius * radius;
  }

  private static List<Vector3Int> BuildPackingOffsets(int maxCount)
  {
    var result = new List<Vector3Int>(maxCount);

    for (int shell = 0; result.Count < maxCount; shell++)
    {
      for (int x = -shell; x <= shell; x++)
        for (int y = -shell; y <= shell; y++)
          for (int z = -shell; z <= shell; z++)
          {
            if (shell > 0 &&
                Mathf.Max(
                  Mathf.Abs(x),
                  Mathf.Max(Mathf.Abs(y), Mathf.Abs(z))) != shell)
            {
              continue;
            }

            result.Add(new Vector3Int(x, y, z));
          }
    }

    return result
      .OrderBy(offset => offset.sqrMagnitude)
      .ThenBy(offset => offset.x)
      .ThenBy(offset => offset.y)
      .ThenBy(offset => offset.z)
      .Take(maxCount)
      .ToList();
  }

  private static Vector3Int ToCell(Vector3 position, float cellSize)
  {
    float safeCellSize = Mathf.Max(0.1f, cellSize);

    return new Vector3Int(
      Mathf.RoundToInt(position.x / safeCellSize),
      Mathf.RoundToInt(position.y / safeCellSize),
      Mathf.RoundToInt(position.z / safeCellSize));
  }

  private static Vector3Int ToOverlapCell(Vector3 position, float cellSize)
  {
    float safeCellSize = Mathf.Max(0.1f, cellSize);

    return new Vector3Int(
      Mathf.FloorToInt(position.x / safeCellSize),
      Mathf.FloorToInt(position.y / safeCellSize),
      Mathf.FloorToInt(position.z / safeCellSize));
  }

  private static Vector3 CellCenter(Vector3Int cell, float cellSize)
  {
    return new Vector3(
      cell.x * cellSize,
      cell.y * cellSize,
      cell.z * cellSize);
  }

  private static Vector3 FibonacciBallPoint(int index, int count)
  {
    if (count <= 1)
      return Vector3.zero;

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

  private static Vector3 GoldenSphereDirection(int index)
  {
    float y =
      1f -
      2f *
      FractionalPart((index + 0.5f) * GOLDEN_RATIO_CONJUGATE);

    float radial = Mathf.Sqrt(Mathf.Max(0f, 1f - y * y));
    float angle = index * GOLDEN_ANGLE_RAD;

    return new Vector3(
      Mathf.Cos(angle) * radial,
      y,
      Mathf.Sin(angle) * radial);
  }

  private static float FractionalPart(float value)
  {
    return value - Mathf.Floor(value);
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
