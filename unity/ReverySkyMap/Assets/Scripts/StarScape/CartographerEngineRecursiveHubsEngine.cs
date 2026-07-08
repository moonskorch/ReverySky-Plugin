using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using UnityEngine;
using UnityEngine.Serialization;

/// <summary>
/// Standalone RecursiveHubs layout for medium and large note graphs.
///
/// The engine starts from top structural maxima, recursively expands through
/// high-degree unplaced neighbors, and only then runs bounded link contraction.
/// It prioritizes structure preservation and reserved space over force-layout
/// equilibrium.
/// </summary>
[DisallowMultipleComponent]
public class CartographerEngineRecursiveHubsEngine : MonoBehaviour, ICartographerEngine
{
  private enum AnimationLifetime
  {
    Instant,
    Timed,
    Endless
  }

  private enum LargeGraphVisualPolicy
  {
    PreserveVisuals,
    DisableSpin,
    DisableSpinAndBillboards
  }

  [Header("Prefabs & Parents")]
  [SerializeField] private StarSO starTemplate;
  [SerializeField] private Transform layoutParent;
  [SerializeField] private TagNodeSO tagNodeTemplate;

  [Header("Progressive construction")]
  [SerializeField, Range(1, 16)] private int constructionBatchesPerFrame = 1;

  [Header("Initial structural scale")]
  [SerializeField, Min(0.1f)] private float nodeSpacingFactor = 8.1f;
  [SerializeField, Min(0.1f)] private float minimumNavigationRadius = 14f;
  [SerializeField, Min(0f)] private float navigationPadding = 7f;
  [SerializeField, Range(0.2f, 2.5f)] private float componentRadiusFactor = 1.12f;
  [SerializeField, Range(0.5f, 5f)] private float componentGapFactor = 1.65f;
  [SerializeField, Range(0.05f, 0.98f)] private float rootSpreadRatio = 0.82f;

  [Header("Structural maxima")]
  [SerializeField, Min(0f)] private float directLinkScoreWeight = 2.8f;
  [SerializeField, Min(0f)] private float noteTagScoreWeight = 0.45f;
  [SerializeField, Min(0f)] private float degreeScoreBonus = 0.62f;
  [SerializeField, Min(0f)] private float tagNodeScoreMultiplier = 1.15f;
  [Tooltip("Caps generic tags so they do not become the center of everything.")]
  [SerializeField, Min(0.1f)] private float maximumTagHubScore = 5.8f;
  [SerializeField, Range(1, 32)] private int maxRootHubsPerComponent = 12;
  [SerializeField, Range(0.1f, 3f)] private float rootCountFactor = 1.05f;
  [SerializeField, Range(0, 5)] private int rootExclusionGraphDepth = 2;
  [SerializeField] private bool preferNotesAsRootHubs = true;

  [Header("Recursive placement")]
  [SerializeField, Min(0.1f)] private float minimumNodeDistance = 2.9f;
  [SerializeField, Min(0.1f)] private float hubChildDistanceFactor = 2.85f;
  [SerializeField, Min(0.1f)] private float leafChildDistanceFactor = 1.55f;
  [SerializeField, Min(0f)] private float childReservationFactor = 1.05f;
  [SerializeField, Min(0.1f)] private float maximumChildReservation = 18f;
  [SerializeField, Min(0f)] private float siblingShellFactor = 0.72f;
  [SerializeField, Range(2, 96)] private int childHubDegreeThreshold = 4;
  [SerializeField, Range(8, 768)] private int maxPlacementAttempts = 192;
  [Tooltip("Extra distance when a new local maximum starts a separate island.")]
  [SerializeField, Min(1f)] private float fallbackHubDistanceFactor = 3.2f;

  [Header("Frontier priority")]
  [SerializeField, Min(0f)] private float directLinkParentWeight = 4.0f;
  [SerializeField, Min(0f)] private float noteTagParentWeight = 0.65f;
  [SerializeField, Min(0f)] private float parentScoreInfluence = 0.07f;
  [SerializeField, Min(0f)] private float parentCrowdingPenalty = 0.28f;
  [SerializeField, Min(0f)] private float frontierTargetScoreWeight = 5.2f;
  [SerializeField, Min(0f)] private float frontierRelationWeight = 1.25f;
  [SerializeField, Min(0f)] private float frontierDepthPenalty = 0.12f;

  [Header("Post-placement link refinement")]
  [FormerlySerializedAs("refinementPasses")]
  [SerializeField, Range(0, 512)] private int linkRefinementPasses = 128;
  [SerializeField, Range(1, 12)] private int refinementPassesPerFrame = 1;
  [Tooltip("Fraction of timed link refinement spent tapering maxMovePerPass toward zero. 0 disables taper. Example: 0.3 means the last 30% of the timed refinement slows down.")]
  [SerializeField, Range(0f, 0.9f)] private float refinementFinishTaperFraction = 0.3f;
  [SerializeField, Range(0f, 1f)] private float linkPull = 0.085f;
  [SerializeField, Min(0.01f)] private float maxMovePerPass = 0.58f;
  [SerializeField, Min(0.01f)] private float noteTagRestLength = 8.6f;
  [SerializeField, Min(0.01f)] private float directLinkRestLength = 7.2f;
  [SerializeField, Min(0.01f)] private float minimumDirectLinkRestLength = 3.5f;
  [SerializeField, Range(0f, 1f)] private float rootMobility = 0.1f;

  [Header("Space preservation")]
  [FormerlySerializedAs("hardNodeSpacingPassesPerRefinement")]
  [SerializeField, Range(0, 8)] private int nodeSpacingPassesPerRefinement = 1;
  [Tooltip("Absolute forbidden radius around each node center. Center-to-center spacing targets twice this value.")]
  [SerializeField, Min(0f)] private float hardNodeSpacingRadius = 1.8f;
  [Tooltip("Preferred breathing radius around each node center. Close-neighbor budget allows limited pairs inside it.")]
  [SerializeField, Min(0f)] private float airNodeSpacingRadius = 3.6f;
  [FormerlySerializedAs("hardNodeSpacingProjectionStrength")]
  [SerializeField, Range(0f, 1f)] private float nodeSpacingProjectionStrength = 1f;
  [Tooltip("How many spatial neighbors a node may keep inside air radius before air spacing pushes additional pairs apart.")]
  [SerializeField, Range(0, 16)] private int closeNeighborBudget = 2;
  [Tooltip("Caps local collision checks per node for dense 10K maps. 0 means unlimited.")]
  [FormerlySerializedAs("maxHardNodeSpacingChecksPerNode")]
  [SerializeField, Range(0, 8192)] private int maxNodeSpacingChecksPerNode = 256;

  [Header("Visual")]
  [SerializeField, Min(0.01f)] private float tagScale = 0.7f;

  [Header("Line Builder")]
  [SerializeField, Min(0)] private int maxActiveLines = 200;
  [SerializeField, Min(0)] private int maxActiveLongLines = 10;

  [Header("Construction Timing")]
  [SerializeField] private AnimationLifetime constructionLifetime = AnimationLifetime.Timed;
  [Tooltip("Used when constructionLifetime is Timed. 0 means instant construction.")]
  [SerializeField, Min(0f)] private float constructionAnimationSeconds = 2.5f;
  [Tooltip("Used when constructionLifetime is Endless. Construction still completes, but at this intentionally slow rate.")]
  [SerializeField, Range(1, 4096)] private int endlessConstructionNodesPerFrame = 120;
  [SerializeField, Range(1f, 120f)] private float timingFrameRate = 30f;

  [Header("Link Timing")]
  [SerializeField] private AnimationLifetime linkRefinementLifetime = AnimationLifetime.Timed;
  [SerializeField, Range(0f, 0.5f)]
  [Tooltip("Visual-only smoothing time in seconds for timed refinement. 0 disables smoothing; larger values soften motion but increase visible lag until the final exact sync.")]
  private float visualSmoothingSeconds = 0.08f;

  private const float GOLDEN_ANGLE_RAD = 2.39996323f;
  private const float GOLDEN_RATIO_CONJUGATE = 0.61803398875f;
  private const float MIN_SQR_DISTANCE = 0.000001f;
  private const float VISUAL_SMOOTHING_FINISH_DISTANCE = 0.001f;

  private float _navigationRadius;
  private Vector3 _layoutCenter;
  private ScapeView _currentView = ScapeView.Planets;

  private int _noteCount;
  private int _rootCount;
  private int _placedCount;
  private int _maxHierarchyDepth;
  private int _placementFallbacks;
  private int _constructionWaves;
  private int _resolvedConstructionNodesPerFrame;
  private int _remainingRefinementPasses;
  private int _completedRefinementPasses;
  private int _resolvedLinkRefinementPasses;
  private int _resolvedLinkRefinementTaperPasses;
  private long _frontierPushes;
  private long _frontierPops;
  private long _nodeSpacingPairChecks;
  private bool _constructionActive;
  private bool _animateConstruction;
  private bool _animateRefinement;
  private bool _visualSmoothingActive;

  private readonly List<Node> _nodes = new();
  private readonly List<Edge> _tagEdges = new();
  private readonly List<Edge> _noteLinks = new();
  private readonly List<Edge> _allEdges = new();
  private readonly List<Edge> _backboneEdges = new();
  private readonly List<Component> _components = new();
  private readonly List<Star> _stars = new();
  private readonly List<TagNode> _tagNodes = new();

  private List<Neighbor>[] _adjacency = Array.Empty<List<Neighbor>>();
  private bool[] _queuedForPlacement = Array.Empty<bool>();
  private Vector3[] _corrections = Array.Empty<Vector3>();
  private int[] _correctionCounts = Array.Empty<int>();
  private int[] _closeNeighborCounts = Array.Empty<int>();

  private readonly PlacementMaxHeap _frontier = new();
  private long _nextPlacementSequence;

  private bool _continuousLinkRefinement;
  private bool _graphHasNodes;
  private readonly HashSet<Vector3Int> _placementCells = new();
  private List<Vector3Int> _packingOffsets = new();

  private readonly Dictionary<Vector3Int, List<int>> _spacingGrid = new();
  private readonly List<List<int>> _spacingBucketPool = new();
  private int _usedSpacingBuckets;

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
    public int RootAnchorIndex = -1;

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

  private readonly struct PlacementCandidate
  {
    public readonly int NodeIndex;
    public readonly float Priority;
    public readonly long Sequence;

    public PlacementCandidate(int nodeIndex, float priority, long sequence)
    {
      NodeIndex = nodeIndex;
      Priority = priority;
      Sequence = sequence;
    }
  }

  private sealed class PlacementMaxHeap
  {
    private readonly List<PlacementCandidate> _items = new();

    public int Count => _items.Count;

    public void Clear()
    {
      _items.Clear();
    }

    public void Push(PlacementCandidate item)
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

    public PlacementCandidate Pop()
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

    private static bool ComesBefore(PlacementCandidate left, PlacementCandidate right)
    {
      int priorityOrder = left.Priority.CompareTo(right.Priority);
      if (priorityOrder != 0)
        return priorityOrder > 0;

      return left.Sequence < right.Sequence;
    }
  }

  public MapLayoutMode EngineType => MapLayoutMode.ScalableLinks;
  public int MaxActiveLines => maxActiveLines;
  public int MaxActiveLongLines => maxActiveLongLines;
  public bool RequiresTick => _constructionActive || _remainingRefinementPasses > 0 ||
    _visualSmoothingActive || (_continuousLinkRefinement && _graphHasNodes);
  public event Action<IReadOnlyList<Star>, IReadOnlyList<TagNode>> OnNodesChanged;
  public float BoundRadius => _navigationRadius;
  public Vector3 Pivot => layoutParent ? layoutParent.TransformPoint(_layoutCenter) : _layoutCenter;
  public ScapeCameraWarper ScapeWarper => null;
  public IReadOnlyList<Star> Stars => _stars;
  public IReadOnlyList<TagNode> TagNodes => _tagNodes;

  private void Awake()
  {
    _navigationRadius = Mathf.Max(0.1f, minimumNavigationRadius);
    _layoutCenter = Vector3.zero;
  }

  public void Tick(float dt)
  {
    if (_constructionActive)
    {
      TickConstruction();
      return;
    }

    if (_remainingRefinementPasses > 0)
    {
      TickFiniteRefinement(dt);
      return;
    }

    if (_visualSmoothingActive)
    {
      TickFinalVisualSmoothing(dt);
      return;
    }

    if (_continuousLinkRefinement && _graphHasNodes)
      TickContinuousRefinement();
  }

  public void BuildGraph(List<NoteData> notes)
  {
    _continuousLinkRefinement = false;
    _graphHasNodes = notes != null && notes.Count > 0;

    int noteCount = notes?.Count ?? 0;
    ConfigureLinkTimingBeforeBuild();
    ConfigureConstructionTimingBeforeBuild(noteCount);

    BuildGraphCore(notes);

    ConfigureConstructionTimingAfterBuild();
    _continuousLinkRefinement =
      _graphHasNodes &&
      linkRefinementLifetime == AnimationLifetime.Endless;
  }

  private void TickConstruction()
  {
    int batches = constructionBatchesPerFrame;
    int budget = Mathf.Max(1, _resolvedConstructionNodesPerFrame);

    for (int i = 0; i < batches && _constructionActive; i++)
    {
      PlaceConstructionBatch(budget);
      InstantiatePlacedNodesWithoutVisuals();

      if (_placedCount >= _nodes.Count)
        CompleteConstruction();
    }
  }

  private void TickFiniteRefinement(float dt)
  {
    if (_remainingRefinementPasses <= 0)
      return;

    int passBudget = Mathf.Min(
      _remainingRefinementPasses,
      refinementPassesPerFrame);

    for (int i = 0; i < passBudget; i++)
    {
      RunRefinementPass();
      _remainingRefinementPasses--;
      _completedRefinementPasses++;
    }

    bool smoothVisuals = ShouldSmoothTimedRefinementVisuals();
    bool visualSettled = UpdateVisualPositions(dt, smoothVisuals);

    if (_remainingRefinementPasses == 0)
    {
      _visualSmoothingActive = smoothVisuals && !visualSettled;
      UpdateNavigationRadius();
      UnityEngine.Debug.Log(
        $"[RecursiveHubs] Refinement completed passes={_completedRefinementPasses}, " +
        $"nodeSpacingChecks={_nodeSpacingPairChecks}, " +
        $"navigationRadius={_navigationRadius:F1}");

      if (!_visualSmoothingActive)
        MapRuntimeContext.RequestGraphReady();
    }
  }

  private void TickContinuousRefinement()
  {
    int passCount = refinementPassesPerFrame;
    for (int i = 0; i < passCount; i++)
      RunRefinementPass();

    UpdateVisualPositions();
  }

  private void TickFinalVisualSmoothing(float dt)
  {
    if (UpdateVisualPositions(dt, true))
    {
      _visualSmoothingActive = false;
      MapRuntimeContext.RequestGraphReady();
    }
  }

  private void BuildGraphCore(List<NoteData> notes)
  {
    var totalStopwatch = Stopwatch.StartNew();

    ClearGraph();

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
        $"[RecursiveHubs] Built empty graph in {totalStopwatch.Elapsed.TotalMilliseconds:F1} ms. " +
        $"LogicalMs={logicalStopwatch.Elapsed.TotalMilliseconds:F1}");
      MapRuntimeContext.RequestGraphReady();
      return;
    }

    var seedStopwatch = Stopwatch.StartNew();
    InitializeStructuralRoots();
    // Keep the camera pivot stable after reset; construction only refines radius later.
    UpdateNavigationCenter();
    UpdateNavigationRadius();
    seedStopwatch.Stop();

    var constructionStopwatch = Stopwatch.StartNew();
    if (_animateConstruction)
    {
      _constructionActive = _placedCount < _nodes.Count;
      InstantiatePlacedNodesWithoutVisuals();

      if (!_constructionActive)
        CompleteConstruction();
    }
    else
    {
      while (_placedCount < _nodes.Count)
        PlaceConstructionBatch(int.MaxValue / 4);

      InstantiatePlacedNodesWithoutVisuals();
      CompleteConstruction();
    }
    constructionStopwatch.Stop();

    totalStopwatch.Stop();

    UnityEngine.Debug.Log(
      $"[RecursiveHubs] Started notes={_noteCount}, tags={_nodes.Count - _noteCount}, " +
      $"tagEdges={_tagEdges.Count}, noteLinks={_noteLinks.Count}, components={_components.Count}, " +
      $"roots={_rootCount}, placed={_placedCount}/{_nodes.Count}, constructionActive={_constructionActive}, " +
      $"constructionWaves={_constructionWaves}, maxHierarchyDepth={_maxHierarchyDepth}, " +
      $"placementFallbacks={_placementFallbacks}, frontierPushes={_frontierPushes}, frontierPops={_frontierPops}, " +
      $"totalMs={totalStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"LogicalMs={logicalStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"InitializeRootsMs={seedStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"ConstructionMs={constructionStopwatch.Elapsed.TotalMilliseconds:F1}");
  }

  private void ConfigureConstructionTimingBeforeBuild(int noteCount)
  {
    bool animate =
      constructionLifetime != AnimationLifetime.Instant &&
      constructionAnimationSeconds > 0f;

    if (constructionLifetime == AnimationLifetime.Endless)
      animate = true;

    _animateConstruction = animate;

    int estimatedNodes = Mathf.Max(1, noteCount);
    _resolvedConstructionNodesPerFrame = ResolveConstructionNodesPerFrame(estimatedNodes);
  }

  private void ConfigureConstructionTimingAfterBuild()
  {
    int actualNodes = _nodes.Count;
    if (actualNodes <= 0)
      return;

    _resolvedConstructionNodesPerFrame = ResolveConstructionNodesPerFrame(actualNodes);
  }

  private int ResolveConstructionNodesPerFrame(int nodeCount)
  {
    if (constructionLifetime == AnimationLifetime.Endless)
      return Mathf.Max(1, endlessConstructionNodesPerFrame);

    if (constructionLifetime == AnimationLifetime.Instant ||
        constructionAnimationSeconds <= 0f)
    {
      return Mathf.Max(1, nodeCount);
    }

    float frames =
      Mathf.Max(1f, constructionAnimationSeconds * Mathf.Max(1f, timingFrameRate));
    return Mathf.Max(1, Mathf.CeilToInt(nodeCount / frames));
  }

  private void ConfigureLinkTimingBeforeBuild()
  {
    switch (linkRefinementLifetime)
    {
      case AnimationLifetime.Instant:
        _animateRefinement = false;
        break;

      case AnimationLifetime.Endless:
        _animateRefinement = true;
        break;

      case AnimationLifetime.Timed:
      default:
        _animateRefinement = true;
        break;
    }

    ResolveLinkRefinementPassPlan();
  }

  private void ResolveLinkRefinementPassPlan()
  {
    if (linkRefinementPasses <= 0)
    {
      _resolvedLinkRefinementPasses = 0;
      _resolvedLinkRefinementTaperPasses = 0;
      return;
    }

    if (linkRefinementLifetime != AnimationLifetime.Timed)
    {
      _resolvedLinkRefinementPasses = linkRefinementPasses;
      _resolvedLinkRefinementTaperPasses = 0;
      return;
    }

    if (refinementFinishTaperFraction <= 0f)
    {
      _resolvedLinkRefinementPasses = linkRefinementPasses;
      _resolvedLinkRefinementTaperPasses = 0;
      return;
    }

    float divisor = 1f - refinementFinishTaperFraction * 0.5f;
    int actualPasses = Mathf.CeilToInt(linkRefinementPasses / divisor);
    int taperPasses = Mathf.RoundToInt(actualPasses * refinementFinishTaperFraction);

    _resolvedLinkRefinementPasses = actualPasses;
    _resolvedLinkRefinementTaperPasses = taperPasses;
  }

  public void ClearGraph()
  {
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
    _tagNodes.Clear();

    _adjacency = Array.Empty<List<Neighbor>>();
    _queuedForPlacement = Array.Empty<bool>();
    _corrections = Array.Empty<Vector3>();
    _correctionCounts = Array.Empty<int>();
    _closeNeighborCounts = Array.Empty<int>();
    _frontier.Clear();
    _placementCells.Clear();
    _packingOffsets.Clear();
    ResetSpacingGrid();

    _noteCount = 0;
    _rootCount = 0;
    _placedCount = 0;
    _maxHierarchyDepth = 0;
    _placementFallbacks = 0;
    _constructionWaves = 0;
    _remainingRefinementPasses = 0;
    _completedRefinementPasses = 0;
    _frontierPushes = 0;
    _frontierPops = 0;
    _nodeSpacingPairChecks = 0;
    _constructionActive = false;
    _visualSmoothingActive = false;
    _nextPlacementSequence = 0;
    _layoutCenter = Vector3.zero;
    _navigationRadius = Mathf.Max(0.1f, minimumNavigationRadius);
    PublishVisualNodesChanged();
  }

  public void ApplyView(ScapeView view)
  {
    _currentView = view;
    bool showDetails = view == ScapeView.Planets;

    for (int i = 0; i < _nodes.Count; i++)
    {
      var node = _nodes[i];
      if (node.TagNode != null)
        node.TagNode.gameObject.SetActive(showDetails);
      if (node.Star != null)
        node.Star.SetView(view);
    }
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
    if (MapRuntimeContext.Links == null)
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
    _queuedForPlacement = new bool[_nodes.Count];

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
        int strengthOrder =
          RelationStrength(right.Kind, right.Weight)
          .CompareTo(RelationStrength(left.Kind, left.Weight));
        if (strengthOrder != 0)
          return strengthOrder;

        int keyOrder = string.CompareOrdinal(
          _nodes[left.NodeIndex].Key,
          _nodes[right.NodeIndex].Key);
        return keyOrder;
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
    if (_components.Count == 0)
      return;

    float cursor = 0f;

    for (int componentIndex = 0; componentIndex < _components.Count; componentIndex++)
    {
      var component = _components[componentIndex];
      component.Radius = Mathf.Max(
        minimumNodeDistance * 3f,
        nodeSpacingFactor *
        Mathf.Pow(Mathf.Max(1, component.Nodes.Count), 1f / 3f) *
        Mathf.Max(0.2f, componentRadiusFactor));

      if (componentIndex == 0)
      {
        component.Center = Vector3.zero;
        cursor = component.Radius;
        continue;
      }

      float distance =
        cursor +
        component.Radius +
        minimumNodeDistance * Mathf.Max(0.5f, componentGapFactor);

      component.Center =
        FibonacciSpherePoint(componentIndex - 1, _components.Count - 1) *
        distance;

      cursor = distance + component.Radius;
    }
  }

  private void InitializeStructuralRoots()
  {
    _packingOffsets = BuildPackingOffsets(maxPlacementAttempts);

    for (int componentIndex = 0; componentIndex < _components.Count; componentIndex++)
    {
      var component = _components[componentIndex];
      var roots = SelectStructuralRoots(component);

      for (int rootOffset = 0; rootOffset < roots.Count; rootOffset++)
      {
        int rootIndex = roots[rootOffset];
        float rootDistance = component.Radius * rootSpreadRatio;
        Vector3 preferredPosition = roots.Count <= 1
          ? component.Center
          : component.Center + FibonacciSpherePoint(rootOffset, roots.Count) * rootDistance;

        Vector3 position = FindFreePosition(
          preferredPosition,
          _nodes[rootIndex].Key,
          101 + rootOffset);

        MarkPlacedRoot(rootIndex, position);
        component.Roots.Add(rootIndex);
        EnqueueUnplacedNeighbors(rootIndex);
      }
    }
  }

  private List<int> SelectStructuralRoots(Component component)
  {
    IEnumerable<int> candidateSource = component.Nodes;
    if (preferNotesAsRootHubs && component.Nodes.Any(nodeIndex => _nodes[nodeIndex].IsNote))
      candidateSource = component.Nodes.Where(nodeIndex => _nodes[nodeIndex].IsNote);

    var orderedCandidates = candidateSource
      .OrderByDescending(nodeIndex => _nodes[nodeIndex].StructuralScore)
      .ThenByDescending(nodeIndex => _adjacency[nodeIndex].Count)
      .ThenBy(nodeIndex => _nodes[nodeIndex].Key, StringComparer.Ordinal)
      .ToList();

    int desiredRootCount = Mathf.Clamp(
      Mathf.CeilToInt(
        Mathf.Pow(Mathf.Max(1, component.Nodes.Count), 1f / 3f) *
        Mathf.Max(0.1f, rootCountFactor)),
      1,
      Mathf.Max(1, maxRootHubsPerComponent));

    desiredRootCount = Mathf.Min(desiredRootCount, orderedCandidates.Count);

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
        rootExclusionGraphDepth,
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

  private void PlaceConstructionBatch(int maxNodes)
  {
    int placedInBatch = 0;

    while (placedInBatch < maxNodes && _placedCount < _nodes.Count)
    {
      if (!TryPopPlaceableFrontierNode(out int nodeIndex) &&
          !TryStartFallbackHub(out nodeIndex))
      {
        return;
      }

      if (!TryFindBestPlacedParent(nodeIndex, out int parentIndex, out Edge relation))
      {
        continue;
      }

      Vector3 preferredPosition = CalculatePreferredChildPosition(parentIndex, nodeIndex, relation);
      Vector3 position = FindFreePosition(
        preferredPosition,
        _nodes[nodeIndex].Key,
        211 + _nodes[parentIndex].AssignedChildCount);

      MarkPlacedChild(nodeIndex, parentIndex, position);
      _backboneEdges.Add(relation);
      EnqueueUnplacedNeighbors(nodeIndex);
      placedInBatch++;
    }

    if (placedInBatch > 0)
      _constructionWaves++;
  }

  private bool TryPopPlaceableFrontierNode(out int nodeIndex)
  {
    while (_frontier.Count > 0)
    {
      var candidate = _frontier.Pop();
      _frontierPops++;

      nodeIndex = candidate.NodeIndex;
      if (nodeIndex < 0 || nodeIndex >= _nodes.Count)
        continue;

      if (_nodes[nodeIndex].IsPlaced)
        continue;

      return true;
    }

    nodeIndex = -1;
    return false;
  }

  private bool TryStartFallbackHub(out int nodeIndex)
  {
    nodeIndex = -1;
    int componentIndex = -1;

    for (int i = 0; i < _components.Count; i++)
    {
      if (HasUnplacedNode(_components[i]))
      {
        componentIndex = i;
        break;
      }
    }

    if (componentIndex < 0)
      return false;

    var component = _components[componentIndex];
    nodeIndex = FindHighestPriorityUnplacedNode(component.Nodes);
    if (nodeIndex < 0)
      return false;

    Vector3 preferredPosition =
      component.Center +
      StableDirection(_nodes[nodeIndex].Key, 307) *
      component.Radius *
      Mathf.Max(1f, fallbackHubDistanceFactor);

    Vector3 position = FindFreePosition(
      preferredPosition,
      _nodes[nodeIndex].Key,
      311 + _placementFallbacks);

    MarkPlacedRoot(nodeIndex, position);
    component.Roots.Add(nodeIndex);
    EnqueueUnplacedNeighbors(nodeIndex);
    _placementFallbacks++;
    return TryPopPlaceableFrontierNode(out nodeIndex);
  }

  private bool HasUnplacedNode(Component component)
  {
    for (int i = 0; i < component.Nodes.Count; i++)
      if (!_nodes[component.Nodes[i]].IsPlaced)
        return true;

    return false;
  }

  private void MarkPlacedRoot(int nodeIndex, Vector3 position)
  {
    var node = _nodes[nodeIndex];
    node.IsPlaced = true;
    node.IsRoot = true;
    node.LayoutParent = -1;
    node.HierarchyDepth = 0;
    node.RootAnchorIndex = nodeIndex;
    node.LocalPosition = position;
    _queuedForPlacement[nodeIndex] = false;

    _rootCount++;
    _placedCount++;
  }

  private void MarkPlacedChild(int nodeIndex, int parentIndex, Vector3 position)
  {
    var node = _nodes[nodeIndex];
    var parent = _nodes[parentIndex];

    node.IsPlaced = true;
    node.IsRoot = false;
    node.LayoutParent = parentIndex;
    node.HierarchyDepth = parent.HierarchyDepth + 1;
    node.RootAnchorIndex = parent.RootAnchorIndex >= 0 ? parent.RootAnchorIndex : parentIndex;
    node.LocalPosition = position;
    _queuedForPlacement[nodeIndex] = false;

    parent.AssignedChildCount++;
    _maxHierarchyDepth = Mathf.Max(_maxHierarchyDepth, node.HierarchyDepth);
    _placedCount++;
  }

  private void EnqueueUnplacedNeighbors(int nodeIndex)
  {
    var from = _nodes[nodeIndex];
    var neighbors = _adjacency[nodeIndex];

    for (int neighborOffset = 0; neighborOffset < neighbors.Count; neighborOffset++)
    {
      var neighbor = neighbors[neighborOffset];
      int targetIndex = neighbor.NodeIndex;
      var target = _nodes[targetIndex];

      if (target.IsPlaced || _queuedForPlacement[targetIndex])
        continue;

      float priority =
        target.StructuralScore * Mathf.Max(0f, frontierTargetScoreWeight) +
        RelationStrength(neighbor.Kind, neighbor.Weight) * Mathf.Max(0f, frontierRelationWeight) -
        from.HierarchyDepth * Mathf.Max(0f, frontierDepthPenalty);

      _frontier.Push(new PlacementCandidate(
        targetIndex,
        priority,
        _nextPlacementSequence++));

      _queuedForPlacement[targetIndex] = true;
      _frontierPushes++;
    }
  }

  private bool TryFindBestPlacedParent(
    int targetIndex,
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

      if (!candidateParent.IsPlaced)
        continue;

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

    float baseDistance =
      minimumNodeDistance *
      (isHubLike
        ? Mathf.Max(0.1f, hubChildDistanceFactor)
        : Mathf.Max(0.1f, leafChildDistanceFactor));

    float reservation =
      minimumNodeDistance *
      Mathf.Max(0f, childReservationFactor) *
      Mathf.Pow(Mathf.Max(1, _adjacency[childIndex].Count), 1f / 3f);

    reservation = Mathf.Min(
      Mathf.Max(0.1f, maximumChildReservation),
      reservation);

    float siblingShell =
      minimumNodeDistance *
      Mathf.Max(0f, siblingShellFactor) *
      Mathf.Pow(parent.AssignedChildCount + 1f, 1f / 3f);

    float relationCompression = relation.Kind == EdgeKind.DirectNoteLink
      ? Mathf.Clamp(Mathf.Sqrt(Mathf.Max(0.01f, relation.Weight)), 0.9f, 1.4f)
      : 1f;

    float distance =
      (baseDistance + reservation + siblingShell) /
      relationCompression;

    Vector3 slotDirection = GoldenSphereDirection(parent.AssignedChildCount);
    Quaternion parentRotation = Quaternion.FromToRotation(
      Vector3.up,
      StableDirection(parent.Key, 401));

    Vector3 outwardFromRoot = Vector3.zero;
    if (parent.RootAnchorIndex >= 0 && parent.RootAnchorIndex != parentIndex)
      outwardFromRoot = (parent.LocalPosition - _nodes[parent.RootAnchorIndex].LocalPosition).normalized;

    Vector3 direction =
      parentRotation * slotDirection +
      StableDirection(child.Key, 409) * 0.24f +
      outwardFromRoot * 0.18f;

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
    Vector3Int origin = ToCell(preferredPosition, minimumNodeDistance);

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
      if (!_placementCells.Add(candidateCell))
        continue;

      Vector3 organicOffset =
        StableDirection(nodeKey, salt + 37) *
        minimumNodeDistance *
        0.18f;

      return CellCenter(candidateCell, minimumNodeDistance) + organicOffset;
    }

    _placementFallbacks++;

    Vector3 fallbackPosition =
      preferredPosition +
      StableDirection(nodeKey, salt + 71) *
      minimumNodeDistance *
      (_placementFallbacks + 1);

    _placementCells.Add(ToCell(fallbackPosition, minimumNodeDistance));
    return fallbackPosition;
  }

  private void CompleteConstruction()
  {
    _constructionActive = false;
    InstantiatePlacedNodesWithoutVisuals();
    UpdateNavigationRadius();

    if (_animateRefinement)
    {
      _remainingRefinementPasses = _resolvedLinkRefinementPasses;
      PublishVisualNodesChanged();
      Cartographer.I?.FocusRuntimeNote(MapRuntimeContext.PendingFocusNoteId);
    }
    else
    {
      for (int i = 0; i < _resolvedLinkRefinementPasses; i++)
      {
        RunRefinementPass();
        _completedRefinementPasses++;
      }

      UpdateVisualPositions();
      _remainingRefinementPasses = 0;
      UpdateNavigationRadius();
      PublishVisualNodesChanged();
      Cartographer.I?.FocusRuntimeNote(MapRuntimeContext.PendingFocusNoteId);
    }

    UnityEngine.Debug.Log(
      $"[RecursiveHubs] Construction completed placed={_placedCount}/{_nodes.Count}, " +
      $"waves={_constructionWaves}, roots={_rootCount}, backboneEdges={_backboneEdges.Count}, " +
      $"remainingRefinementPasses={_remainingRefinementPasses}, " +
      $"targetFullPasses={linkRefinementPasses}, resolvedPasses={_resolvedLinkRefinementPasses}, " +
      $"taperPasses={_resolvedLinkRefinementTaperPasses}, taperFraction={refinementFinishTaperFraction:F2}, " +
      $"navigationRadius={_navigationRadius:F1}");

    if (_remainingRefinementPasses == 0 || linkRefinementLifetime == AnimationLifetime.Endless)
      MapRuntimeContext.RequestGraphReady();
  }

  private void RunRefinementPass()
  {
    if (_nodes.Count <= 1)
      return;

    EnsureCorrectionBuffers();
    Array.Clear(_corrections, 0, _corrections.Length);
    Array.Clear(_correctionCounts, 0, _correctionCounts.Length);

    ApplyLinkContractionCorrections();
    ApplyCorrections();

    for (int pass = 0; pass < nodeSpacingPassesPerRefinement; pass++)
      ApplyNodeSpacingPass();
  }

  private float ResolveCurrentMaxMovePerPass()
  {
    float baseMaxMove = Mathf.Max(0f, maxMovePerPass);

    if (linkRefinementLifetime != AnimationLifetime.Timed ||
        _resolvedLinkRefinementPasses <= 0 ||
        _resolvedLinkRefinementTaperPasses <= 0)
    {
      return baseMaxMove;
    }

    int currentPass = _completedRefinementPasses + 1;
    int taperStartPass =
      _resolvedLinkRefinementPasses -
      _resolvedLinkRefinementTaperPasses +
      1;

    if (currentPass < taperStartPass)
      return baseMaxMove;

    if (_resolvedLinkRefinementTaperPasses <= 1)
      return 0f;

    float progress =
      (currentPass - taperStartPass) /
      (float)(_resolvedLinkRefinementTaperPasses - 1);

    float multiplier = 1f - Mathf.SmoothStep(0f, 1f, progress);
    return baseMaxMove * multiplier;
  }

  private void ApplyLinkContractionCorrections()
  {
    if (_allEdges.Count == 0)
      return;

    float currentMaxMove = ResolveCurrentMaxMovePerPass();

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
      if (extension <= 0f)
        continue;

      float weightScale = edge.Kind == EdgeKind.DirectNoteLink
        ? Mathf.Clamp(Mathf.Sqrt(Mathf.Max(0.01f, edge.Weight)), 0.55f, 2.2f)
        : 0.42f;

      float move = Mathf.Min(
        currentMaxMove,
        extension * linkPull * weightScale);

      Vector3 correction = delta / distance * (move * 0.5f);

      _corrections[edge.A] += correction * NodeMobility(a);
      _corrections[edge.B] -= correction * NodeMobility(b);
      _correctionCounts[edge.A]++;
      _correctionCounts[edge.B]++;
    }
  }

  private void ApplyNodeSpacingPass()
  {
    // This is a collision-style projection, not a force: it protects node space
    // while leaving link geometry decisions to link contraction.
    float hardDistance = Mathf.Max(0f, hardNodeSpacingRadius) * 2f;
    float airDistance = Mathf.Max(hardDistance, Mathf.Max(0f, airNodeSpacingRadius) * 2f);
    if (airDistance <= 0f || nodeSpacingProjectionStrength <= 0f)
      return;

    EnsureNodeSpacingBuffers();
    Array.Clear(_closeNeighborCounts, 0, _closeNeighborCounts.Length);
    BuildSpacingGrid(airDistance);

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      var node = _nodes[nodeIndex];
      Vector3Int origin = ToCell(node.LocalPosition, airDistance);
      int checks = 0;
      bool hasCheckLimit = maxNodeSpacingChecksPerNode > 0;

      for (int x = -1; x <= 1 && (!hasCheckLimit || checks < maxNodeSpacingChecksPerNode); x++)
        for (int y = -1; y <= 1 && (!hasCheckLimit || checks < maxNodeSpacingChecksPerNode); y++)
          for (int z = -1; z <= 1 && (!hasCheckLimit || checks < maxNodeSpacingChecksPerNode); z++)
          {
            if (!_spacingGrid.TryGetValue(origin + new Vector3Int(x, y, z), out var bucket))
              continue;

            for (int bucketOffset = 0;
                 bucketOffset < bucket.Count && (!hasCheckLimit || checks < maxNodeSpacingChecksPerNode);
                 bucketOffset++)
            {
              int otherIndex = bucket[bucketOffset];
              if (otherIndex <= nodeIndex)
                continue;

              checks++;
              _nodeSpacingPairChecks++;
              ApplyNodeSpacingPair(nodeIndex, otherIndex, hardDistance, airDistance);
            }
          }
    }
  }

  private void ApplyNodeSpacingPair(
    int nodeIndex,
    int otherIndex,
    float hardDistance,
    float airDistance)
  {
    var node = _nodes[nodeIndex];
    var other = _nodes[otherIndex];

    Vector3 delta = other.LocalPosition - node.LocalPosition;
    float distanceSqr = delta.sqrMagnitude;
    float airDistanceSqr = airDistance * airDistance;

    if (distanceSqr >= airDistanceSqr)
      return;

    Vector3 direction;
    float distance;

    if (distanceSqr <= MIN_SQR_DISTANCE)
    {
      direction = StablePairDirection(nodeIndex, otherIndex, 907);
      distance = 0f;
    }
    else
    {
      distance = Mathf.Sqrt(distanceSqr);
      direction = delta / distance;
    }

    float desiredDistance = ResolveNodeSpacingDistance(nodeIndex, otherIndex, distance, hardDistance, airDistance);
    if (desiredDistance <= distance)
      return;

    float projection = (desiredDistance - distance) *
      Mathf.Clamp01(nodeSpacingProjectionStrength);
    if (projection <= 0f)
      return;

    float nodeMobility = NodeMobility(node);
    float otherMobility = NodeMobility(other);
    float mobilitySum = nodeMobility + otherMobility;
    if (mobilitySum <= 0f)
      return;

    _nodes[nodeIndex].LocalPosition -= direction * (projection * (nodeMobility / mobilitySum));
    _nodes[otherIndex].LocalPosition += direction * (projection * (otherMobility / mobilitySum));
  }

  private float ResolveNodeSpacingDistance(
    int nodeIndex,
    int otherIndex,
    float distance,
    float hardDistance,
    float airDistance)
  {
    bool hasCloseBudget =
      closeNeighborBudget > 0 &&
      _closeNeighborCounts[nodeIndex] < closeNeighborBudget &&
      _closeNeighborCounts[otherIndex] < closeNeighborBudget;

    if (hasCloseBudget)
    {
      _closeNeighborCounts[nodeIndex]++;
      _closeNeighborCounts[otherIndex]++;
      return distance < hardDistance ? hardDistance : distance;
    }

    return distance < hardDistance
      ? Mathf.Max(hardDistance, airDistance)
      : airDistance;
  }

  private void ApplyCorrections()
  {
    float currentMaxMove = ResolveCurrentMaxMovePerPass();

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      int correctionCount = _correctionCounts[nodeIndex];
      if (correctionCount <= 0)
        continue;

      Vector3 correction = _corrections[nodeIndex] / correctionCount;
      if (correction.sqrMagnitude <= MIN_SQR_DISTANCE)
        continue;

      if (correction.magnitude > currentMaxMove)
        correction = currentMaxMove > 0f
          ? correction.normalized * currentMaxMove
          : Vector3.zero;

      _nodes[nodeIndex].LocalPosition += correction;
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
      Mathf.Max(0.01f, directLinkRestLength) * 1.65f);
  }

  private float NodeMobility(Node node)
  {
    return node.IsRoot
      ? Mathf.Clamp01(rootMobility)
      : 1f;
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

  private void EnsureNodeSpacingBuffers()
  {
    if (_closeNeighborCounts.Length == _nodes.Count)
      return;

    _closeNeighborCounts = new int[_nodes.Count];
  }

  private void BuildSpacingGrid(float cellSize)
  {
    float safeCellSize = Mathf.Max(0.1f, cellSize);
    ResetSpacingGrid();

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      Vector3Int cell = ToCell(_nodes[nodeIndex].LocalPosition, safeCellSize);
      GetOrCreateSpacingBucket(cell).Add(nodeIndex);
    }
  }

  private void ResetSpacingGrid()
  {
    _spacingGrid.Clear();
    _usedSpacingBuckets = 0;
  }

  private List<int> GetOrCreateSpacingBucket(Vector3Int cell)
  {
    if (_spacingGrid.TryGetValue(cell, out var bucket))
      return bucket;

    if (_usedSpacingBuckets < _spacingBucketPool.Count)
    {
      bucket = _spacingBucketPool[_usedSpacingBuckets];
      bucket.Clear();
    }
    else
    {
      bucket = new List<int>(8);
      _spacingBucketPool.Add(bucket);
    }

    _usedSpacingBuckets++;
    _spacingGrid[cell] = bucket;
    return bucket;
  }

  private void InstantiatePlacedNodesWithoutVisuals()
  {
    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      var node = _nodes[nodeIndex];
      if (!node.IsPlaced || node.VisualTransform != null)
        continue;

      InstantiateNode(nodeIndex);
    }
  }

  private void InstantiateNode(int nodeIndex)
  {
    var node = _nodes[nodeIndex];
    Vector3 worldPosition = ToWorldPosition(node.LocalPosition);

    if (node.IsNote)
    {
      node.Star = starTemplate.Instantiate(
        worldPosition,
        node.Note,
        layoutParent);

      if (node.Star != null)
      {
        node.Star.SetView(_currentView);
        _stars.Add(node.Star);
      }

      return;
    }

    if (tagNodeTemplate == null)
      return;

    node.TagNode = TagNode.Create(
      tagNodeTemplate,
      worldPosition,
      node.TagId,
      layoutParent);

    if (node.TagNode != null)
    {
      node.TagNode.transform.localScale = Vector3.one * tagScale;
      node.TagNode.gameObject.SetActive(_currentView == ScapeView.Planets);
      _tagNodes.Add(node.TagNode);
    }
  }

  private bool ShouldSmoothTimedRefinementVisuals()
  {
    return linkRefinementLifetime == AnimationLifetime.Timed &&
      visualSmoothingSeconds > 0f;
  }

  private bool UpdateVisualPositions()
  {
    return UpdateVisualPositions(0f, false);
  }

  private bool UpdateVisualPositions(float dt, bool smoothVisuals)
  {
    bool allSettled = true;
    float finishDistanceSqr =
      VISUAL_SMOOTHING_FINISH_DISTANCE *
      VISUAL_SMOOTHING_FINISH_DISTANCE;
    float smoothingBlend = smoothVisuals
      ? ResolveVisualSmoothingBlend(dt)
      : 1f;

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      var visualTransform = _nodes[nodeIndex].VisualTransform;
      if (!visualTransform)
        continue;

      Vector3 targetPosition = ToWorldPosition(_nodes[nodeIndex].LocalPosition);
      if (!smoothVisuals)
      {
        visualTransform.position = targetPosition;
        continue;
      }

      Vector3 nextPosition = Vector3.Lerp(
        visualTransform.position,
        targetPosition,
        smoothingBlend);

      if ((targetPosition - nextPosition).sqrMagnitude <= finishDistanceSqr)
      {
        nextPosition = targetPosition;
      }
      else
      {
        allSettled = false;
      }

      visualTransform.position = nextPosition;
    }

    return allSettled;
  }

  private float ResolveVisualSmoothingBlend(float dt)
  {
    if (dt <= 0f)
      return 1f;

    float smoothingSeconds = Mathf.Max(0.01f, visualSmoothingSeconds);
    return Mathf.Clamp01(1f - Mathf.Exp(-dt / smoothingSeconds));
  }

  private void UpdateNavigationCenter()
  {
    if (_placedCount == 0)
    {
      _layoutCenter = Vector3.zero;
      return;
    }

    Vector3 center = Vector3.zero;
    int count = 0;
    for (int i = 0; i < _nodes.Count; i++)
    {
      if (!_nodes[i].IsPlaced)
        continue;

      center += _nodes[i].LocalPosition;
      count++;
    }

    center /= Mathf.Max(1, count);
    _layoutCenter = center;
  }

  private void UpdateNavigationRadius()
  {
    float maxDistance = 0f;
    for (int i = 0; i < _nodes.Count; i++)
    {
      if (!_nodes[i].IsPlaced)
        continue;

      maxDistance = Mathf.Max(maxDistance, Vector3.Distance(_layoutCenter, _nodes[i].LocalPosition));
    }

    _navigationRadius = Mathf.Max(
      Mathf.Max(0.1f, minimumNavigationRadius),
      maxDistance + Mathf.Max(0f, navigationPadding));
  }

  private Vector3 ToWorldPosition(Vector3 localPosition)
  {
    return layoutParent
      ? layoutParent.TransformPoint(localPosition)
      : localPosition;
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

    int degreeOrder =
      _adjacency[right].Count.CompareTo(_adjacency[left].Count);
    if (degreeOrder != 0)
      return degreeOrder;

    if (_nodes[left].IsNote != _nodes[right].IsNote)
      return _nodes[left].IsNote ? -1 : 1;

    return CompareNodeKeys(left, right);
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

  private static Vector3 CellCenter(Vector3Int cell, float cellSize)
  {
    return new Vector3(
      cell.x * cellSize,
      cell.y * cellSize,
      cell.z * cellSize);
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

  private void PublishVisualNodesChanged()
  {
    OnNodesChanged?.Invoke(_stars, _tagNodes);
  }
}
