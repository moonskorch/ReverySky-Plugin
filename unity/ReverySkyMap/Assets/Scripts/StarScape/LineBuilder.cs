using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Pool;

/// <summary>
/// Builds culling-driven edge visuals for the active graph nodes.
/// Physical line renderers are pooled because visibility changes can be frequent while graph data stays stable.
/// </summary>
public sealed class LineBuilder : MonoBehaviour, ICullingConsumer
{
  // WARNING: The current LR_Unlit line material was verified to read _Color.
  // Recheck this property if the line shader, material, or render pipeline changes.
  private static readonly int ColorPropertyId = Shader.PropertyToID("_Color");

  private readonly struct EdgeKey : IEquatable<EdgeKey>
  {
    private readonly MapGraphNodeId nodeAId;
    private readonly MapGraphNodeId nodeBId;

    public EdgeKey(MapGraphNodeId nodeAId, MapGraphNodeId nodeBId)
    {
      if (nodeAId.Value <= nodeBId.Value)
      {
        this.nodeAId = nodeAId;
        this.nodeBId = nodeBId;
      }
      else
      {
        this.nodeAId = nodeBId;
        this.nodeBId = nodeAId;
      }
    }

    public bool Equals(EdgeKey other)
    {
      return nodeAId.Equals(other.nodeAId) && nodeBId.Equals(other.nodeBId);
    }

    public override bool Equals(object obj)
    {
      return obj is EdgeKey other && Equals(other);
    }

    public override int GetHashCode()
    {
      unchecked
      {
        return (nodeAId.GetHashCode() * 397) ^ nodeBId.GetHashCode();
      }
    }
  }

  private sealed class LineCandidate
  {
    public EdgeKey edgeKey;
    public MapGraphNodeId nodeAId;
    public MapGraphNodeId nodeBId;
    public Transform transformA;
    public Transform transformB;
  }

  private sealed class LineBinding
  {
    public LineRenderer line;
    public LineCandidate candidate;
    public Transform transformA;
    public Transform transformB;
  }

  [SerializeField] private LineRenderer linePrefab;
  [SerializeField] private Transform lineParent;
  [SerializeField] private FocusNode focusNode;
  [SerializeField, Min(0.01f)] private float radius = 1f;
  [SerializeField, Min(0.01f)] private float visibleDistance = 80f;
  [SerializeField, Min(0f)] private float longLineDistance = 50f;
  [SerializeField] private bool focusedLinesIgnoreLongLineLimit = true;
  [SerializeField, Range(0f, 1f)] private float visibleRegionRefreshLineRatio = 0.05f;
  [SerializeField, Min(1)] private int maxLinesPerNode = 50;

  private readonly HashSet<MapGraphNodeId> registeredNodeIds = new();
  private readonly Dictionary<MapGraphNodeId, List<LineCandidate>> candidatesByNodeId = new();
  private readonly Dictionary<EdgeKey, LineBinding> activeLinesByEdgeKey = new();
  private readonly HashSet<MapGraphNodeId> visibleNodeIds = new();
  // One-shot batch of nodes that crossed into visibility since the last reconciliation.
  // Current visibility remains authoritative, so fast fly-by nodes can be skipped lazily.
  private readonly Queue<MapGraphNodeId> newlyVisibleNodeIds = new();
  private readonly HashSet<EdgeKey> desiredLineKeys = new();
  private readonly List<LineCandidate> desiredLineCandidates = new();
  private readonly List<EdgeKey> staleLineKeys = new();
  private readonly Dictionary<MapGraphNodeId, int> selectedLineCountByNodeId = new();
  private ObjectPool<LineRenderer> linePool;
  private int activeLineLimit;
  private int activeLongLineLimit;
  private int linePoolMaxSize;
  private bool lineSetDirty;
  private bool linesVisible = true;
  private MapGraphNodeId focusedNodeId = MapGraphNodeId.None;
  private MapGraphNodeId highlightedFocusNodeId = MapGraphNodeId.None;
  private Color focusedLineColor;
  private MaterialPropertyBlock focusedLinePropertyBlock;

  public void Rebuild(
    MapGraphIndex graphIndex,
    int maxActiveLines,
    int maxActiveLongLines)
  {
    activeLineLimit = Mathf.Max(0, maxActiveLines);
    activeLongLineLimit = Mathf.Max(0, maxActiveLongLines);
    // Release active lines before resizing so the old pool owns all inactive renderers it may dispose.
    ClearActiveLines();
    ClearLineState();
    EnsureLinePoolSize(activeLineLimit);

    if (activeLineLimit == 0)
      return;

    RegisterGraphNodes(graphIndex);
    BuildLineCandidates(graphIndex);
  }

  private void OnDestroy()
  {
    ClearActiveLines();
    DisposeLinePool();
    ClearLineState();
  }

  public void SetLinesVisible(bool visible)
  {
    if (linesVisible == visible)
      return;

    linesVisible = visible;
    ApplyActiveLineVisibility();
  }

  private void ClearLineState()
  {
    registeredNodeIds.Clear();
    candidatesByNodeId.Clear();
    visibleNodeIds.Clear();
    ClearReconciliationScratch();
  }

  private void ClearReconciliationScratch()
  {
    desiredLineKeys.Clear();
    desiredLineCandidates.Clear();
    staleLineKeys.Clear();
    newlyVisibleNodeIds.Clear();
    selectedLineCountByNodeId.Clear();
    lineSetDirty = false;
    focusedNodeId = MapGraphNodeId.None;
  }

  public bool TryCreateDistanceEntry(Component node, out CullingManager.Entry entry)
  {
    entry = null;

    if (node == null || !registeredNodeIds.Contains(MapGraphNodeId.FromComponent(node)))
      return false;

    entry = new CullingManager.Entry
    {
      node = node,
      referenceTransform = node.transform,
      consumer = this,
      radius = radius,
      visibleDistance = visibleDistance
    };

    return true;
  }

  public void SetDistanceVisible(Component node, bool visible)
  {
    if (node == null)
      return;

    MapGraphNodeId nodeId = MapGraphNodeId.FromComponent(node);
    if (!registeredNodeIds.Contains(nodeId))
      return;

    if (visible)
    {
      if (!visibleNodeIds.Add(nodeId))
        return;

      EnqueueNewlyVisibleNode(nodeId);
      MarkLineSetDirty();
      return;
    }

    if (!visibleNodeIds.Remove(nodeId))
      return;

    MarkLineSetDirty();
  }

  private void LateUpdate()
  {
    UpdateFocusedNodeDirtyState();
    ReconcileActiveLinesIfDirty();
    UpdateActiveLinePositions();
  }

  private void MarkLineSetDirty()
  {
    lineSetDirty = true;
  }

  public void ApplyFocusHighlightChange(
    MapGraphNodeId previousFocusedNodeId,
    MapGraphNodeId nextFocusedNodeId,
    Color focusColor)
  {
    focusedLineColor = focusColor;
    highlightedFocusNodeId = nextFocusedNodeId;
    RestyleIncidentActiveLines(previousFocusedNodeId);
    if (!previousFocusedNodeId.Equals(nextFocusedNodeId))
      RestyleIncidentActiveLines(nextFocusedNodeId);
  }

  private void ReconcileActiveLinesIfDirty()
  {
    if (!lineSetDirty)
      return;

    lineSetDirty = false;
    ReconcileActiveLines();
  }

  private void UpdateActiveLinePositions()
  {
    if (activeLineLimit == 0 || activeLinesByEdgeKey.Count == 0)
      return;

    staleLineKeys.Clear();
    foreach (var pair in activeLinesByEdgeKey)
    {
      LineBinding binding = pair.Value;
      if (binding == null || binding.line == null || binding.transformA == null || binding.transformB == null)
      {
        staleLineKeys.Add(pair.Key);
        continue;
      }

      binding.line.SetPosition(0, binding.transformA.position);
      binding.line.SetPosition(1, binding.transformB.position);
    }

    for (int i = 0; i < staleLineKeys.Count; i++)
      RemoveLine(staleLineKeys[i]);
  }

  private void RegisterGraphNodes(MapGraphIndex graphIndex)
  {
    if (graphIndex == null)
      return;

    IReadOnlyList<MapGraphNode> nodes = graphIndex.Nodes;
    for (int i = 0; i < nodes.Count; i++)
      RegisterNode(nodes[i]);
  }

  private void RegisterNode(MapGraphNode node)
  {
    if (!node.Id.IsValid || node.Component == null)
      return;

    if (!registeredNodeIds.Add(node.Id))
      return;

    EnsureCandidateList(node.Id);
  }

  private void BuildLineCandidates(MapGraphIndex graphIndex)
  {
    if (graphIndex == null)
      return;

    IReadOnlyList<MapGraphEdge> edges = graphIndex.Edges;
    for (int i = 0; i < edges.Count; i++)
    {
      MapGraphEdge edge = edges[i];
      if (!graphIndex.TryGetNode(edge.NodeA, out var nodeA) ||
          !graphIndex.TryGetNode(edge.NodeB, out var nodeB))
        continue;

      TryAddCandidate(nodeA, nodeB);
    }
  }

  private void TryAddCandidate(MapGraphNode nodeA, MapGraphNode nodeB)
  {
    if (!nodeA.Id.IsValid || !nodeB.Id.IsValid || nodeA.Transform == null || nodeB.Transform == null)
      return;

    if (nodeA.Id.Equals(nodeB.Id) ||
        !registeredNodeIds.Contains(nodeA.Id) ||
        !registeredNodeIds.Contains(nodeB.Id))
    {
      return;
    }

    EdgeKey edgeKey = new(nodeA.Id, nodeB.Id);
    var candidate = new LineCandidate
    {
      edgeKey = edgeKey,
      nodeAId = nodeA.Id,
      nodeBId = nodeB.Id,
      transformA = nodeA.Transform,
      transformB = nodeB.Transform
    };

    EnsureCandidateList(nodeA.Id).Add(candidate);
    EnsureCandidateList(nodeB.Id).Add(candidate);
  }

  private List<LineCandidate> EnsureCandidateList(MapGraphNodeId nodeId)
  {
    if (!candidatesByNodeId.TryGetValue(nodeId, out var candidates))
    {
      candidates = new List<LineCandidate>();
      candidatesByNodeId[nodeId] = candidates;
    }

    return candidates;
  }

  private void ReconcileActiveLines()
  {
    if (activeLineLimit <= 0)
    {
      ClearActiveLines();
      return;
    }

    BuildDesiredLineSetStreaming();
    RemoveLinesOutsideDesiredSet();
    AddMissingDesiredLines();
  }

  private void BuildDesiredLineSetStreaming()
  {
    desiredLineKeys.Clear();
    desiredLineCandidates.Clear();
    selectedLineCountByNodeId.Clear();

    int selectedLongLineCount = 0;
    AddFocusedLines(ref selectedLongLineCount);
    // Newly visible regions get a bounded chance to preempt old retained lines,
    // while focused lines stay protected by being selected first.
    AddNewlyVisibleLines(ref selectedLongLineCount);
    RetainActiveLines(ref selectedLongLineCount);
    FillVisibleLines(ref selectedLongLineCount);
  }

  private void AddFocusedLines(ref int selectedLongLineCount)
  {
    if (!focusedNodeId.IsValid ||
        !candidatesByNodeId.TryGetValue(focusedNodeId, out var candidates))
    {
      return;
    }

    for (int i = 0; i < candidates.Count; i++)
    {
      AddDesiredLine(
        candidates[i],
        ignoreLongLineLimit: focusedLinesIgnoreLongLineLimit,
        ref selectedLongLineCount);
      if (HasFilledLineLimit() || HasFilledNodeLineLimit(focusedNodeId))
        return;
    }
  }

  private void RetainActiveLines(ref int selectedLongLineCount)
  {
    foreach (var pair in activeLinesByEdgeKey)
    {
      LineCandidate candidate = pair.Value?.candidate;
      if (candidate == null)
        continue;

      AddDesiredLine(candidate, ignoreLongLineLimit: false, ref selectedLongLineCount);
      if (HasFilledLineLimit())
        return;
    }
  }

  private void AddNewlyVisibleLines(ref int selectedLongLineCount)
  {
    int refreshBudget = ResolveVisibleRegionRefreshLineBudget();
    if (refreshBudget <= 0 || newlyVisibleNodeIds.Count == 0)
    {
      ClearNewlyVisibleQueue();
      return;
    }

    int addedCount = 0;
    int pendingCount = newlyVisibleNodeIds.Count;
    for (int i = 0; i < pendingCount; i++)
    {
      MapGraphNodeId nodeId = newlyVisibleNodeIds.Dequeue();

      // The queue is an event batch, not the source of truth; visibility may
      // already have changed again before this reconciliation runs.
      if (HasFilledLineLimit() ||
          addedCount >= refreshBudget ||
          HasFilledNodeLineLimit(nodeId) ||
          !visibleNodeIds.Contains(nodeId) ||
          !candidatesByNodeId.TryGetValue(nodeId, out var candidates))
      {
        continue;
      }

      for (int candidateIndex = 0; candidateIndex < candidates.Count; candidateIndex++)
      {
        if (AddDesiredLine(candidates[candidateIndex], ignoreLongLineLimit: false, ref selectedLongLineCount))
          addedCount++;

        if (HasFilledLineLimit() || HasFilledNodeLineLimit(nodeId) || addedCount >= refreshBudget)
          break;
      }
    }
  }

  private void FillVisibleLines(ref int selectedLongLineCount)
  {
    foreach (MapGraphNodeId nodeId in visibleNodeIds)
    {
      if (HasFilledNodeLineLimit(nodeId) ||
          !candidatesByNodeId.TryGetValue(nodeId, out var candidates))
      {
        continue;
      }

      for (int i = 0; i < candidates.Count; i++)
      {
        AddDesiredLine(candidates[i], ignoreLongLineLimit: false, ref selectedLongLineCount);
        if (HasFilledLineLimit())
          return;
        if (HasFilledNodeLineLimit(nodeId))
          break;
      }
    }
  }

  private bool AddDesiredLine(
    LineCandidate candidate,
    bool ignoreLongLineLimit,
    ref int selectedLongLineCount)
  {
    if (!CanSelectCandidate(candidate))
      return false;

    // Long-line budget is a selection-time heuristic; layout motion may move active lines
    // across the threshold until the next visibility or focus reconciliation.
    bool isLongLine = IsLongLine(candidate);
    if (isLongLine && !ignoreLongLineLimit && selectedLongLineCount >= activeLongLineLimit)
      return false;

    if (!desiredLineKeys.Add(candidate.edgeKey))
      return false;

    desiredLineCandidates.Add(candidate);
    TrackSelectedLine(candidate);

    if (isLongLine)
      selectedLongLineCount++;

    return true;
  }

  private bool CanSelectCandidate(LineCandidate candidate)
  {
    return candidate != null &&
           !HasFilledLineLimit() &&
           !HasFilledNodeLineLimit(candidate.nodeAId) &&
           !HasFilledNodeLineLimit(candidate.nodeBId) &&
           IsCandidateVisible(candidate);
  }

  private bool HasFilledLineLimit()
  {
    return desiredLineKeys.Count >= activeLineLimit;
  }

  private bool HasFilledNodeLineLimit(MapGraphNodeId nodeId)
  {
    return selectedLineCountByNodeId.TryGetValue(nodeId, out int selectedCount) &&
           selectedCount >= maxLinesPerNode;
  }

  private void TrackSelectedLine(LineCandidate candidate)
  {
    IncrementSelectedLineCount(candidate.nodeAId);
    IncrementSelectedLineCount(candidate.nodeBId);
  }

  private void IncrementSelectedLineCount(MapGraphNodeId nodeId)
  {
    selectedLineCountByNodeId.TryGetValue(nodeId, out int selectedCount);
    selectedLineCountByNodeId[nodeId] = selectedCount + 1;
  }

  private int ResolveVisibleRegionRefreshLineBudget()
  {
    if (activeLineLimit <= 0 || visibleRegionRefreshLineRatio <= 0f)
      return 0;

    return Mathf.CeilToInt(activeLineLimit * Mathf.Clamp01(visibleRegionRefreshLineRatio));
  }

  private void EnqueueNewlyVisibleNode(MapGraphNodeId nodeId)
  {
    if (!nodeId.IsValid)
      return;

    newlyVisibleNodeIds.Enqueue(nodeId);
  }

  private void ClearNewlyVisibleQueue()
  {
    newlyVisibleNodeIds.Clear();
  }

  private void RemoveLinesOutsideDesiredSet()
  {
    staleLineKeys.Clear();
    foreach (var pair in activeLinesByEdgeKey)
    {
      if (!desiredLineKeys.Contains(pair.Key))
        staleLineKeys.Add(pair.Key);
    }

    for (int i = 0; i < staleLineKeys.Count; i++)
      RemoveLine(staleLineKeys[i]);
  }

  private void AddMissingDesiredLines()
  {
    for (int i = 0; i < desiredLineCandidates.Count; i++)
    {
      LineCandidate candidate = desiredLineCandidates[i];
      if (candidate == null || activeLinesByEdgeKey.ContainsKey(candidate.edgeKey))
        continue;

      ShowLine(candidate);

      if (activeLinesByEdgeKey.Count >= activeLineLimit)
        return;
    }
  }

  private void ShowLine(LineCandidate candidate)
  {
    if (candidate == null || activeLinesByEdgeKey.ContainsKey(candidate.edgeKey))
      return;

    if (activeLineLimit <= 0 || activeLinesByEdgeKey.Count >= activeLineLimit)
      return;

    if (linePrefab == null)
      return;

    EnsureLinePoolSize(activeLineLimit);

    LineRenderer line = linePool.Get();
    line.positionCount = 2;
    line.enabled = linesVisible;
    line.SetPosition(0, candidate.transformA.position);
    line.SetPosition(1, candidate.transformB.position);

    activeLinesByEdgeKey[candidate.edgeKey] = new LineBinding
    {
      line = line,
      candidate = candidate,
      transformA = candidate.transformA,
      transformB = candidate.transformB
    };

    ApplyLineStyle(line, IsFocusedLine(candidate));
  }

  private void RemoveLine(EdgeKey edgeKey)
  {
    if (!activeLinesByEdgeKey.TryGetValue(edgeKey, out LineBinding binding))
      return;

    activeLinesByEdgeKey.Remove(edgeKey);

    if (binding?.line != null)
      linePool.Release(binding.line);
  }

  private void ClearActiveLines()
  {
    foreach (var pair in activeLinesByEdgeKey)
    {
      LineBinding binding = pair.Value;
      if (binding?.line != null)
      {
        if (linePool != null)
          linePool.Release(binding.line);
        else
          DestroyPooledLine(binding.line);
      }
    }

    activeLinesByEdgeKey.Clear();
  }

  private void ApplyActiveLineVisibility()
  {
    foreach (var pair in activeLinesByEdgeKey)
    {
      LineBinding binding = pair.Value;
      if (binding?.line != null)
        binding.line.enabled = linesVisible;
    }
  }

  private void EnsureLinePoolSize(int requiredMaxSize)
  {
    if (requiredMaxSize <= 0 || linePrefab == null)
    {
      // A zero limit means the active engine does not use LineBuilder-managed lines at all.
      DisposeLinePool();
      return;
    }

    if (linePool != null && linePoolMaxSize == requiredMaxSize)
      return;

    var previousPool = linePool;
    linePoolMaxSize = requiredMaxSize;
    // Engine switches are rare, so matching the pool size to the current line limit
    // is clearer than retaining a high-water mark.
    linePool = new ObjectPool<LineRenderer>(
      CreateLine,
      PrepareLineForUse,
      PrepareLineForPool,
      DestroyPooledLine,
      collectionCheck: false,
      defaultCapacity: requiredMaxSize,
      maxSize: requiredMaxSize);

    previousPool?.Dispose();
  }

  private LineRenderer CreateLine()
  {
    Transform parent = lineParent != null ? lineParent : transform;
    LineRenderer line = Instantiate(linePrefab, parent);
    line.gameObject.SetActive(false);
    return line;
  }

  private void PrepareLineForUse(LineRenderer line)
  {
    if (line == null)
      return;

    Transform parent = lineParent != null ? lineParent : transform;
    if (line.transform.parent != parent)
      line.transform.SetParent(parent, false);
    line.gameObject.SetActive(true);
  }

  private void PrepareLineForPool(LineRenderer line)
  {
    if (line == null)
      return;

    ApplyLineStyle(line, focused: false);
    line.positionCount = 0;
    line.gameObject.SetActive(false);
  }

  private static void DestroyPooledLine(LineRenderer line)
  {
    if (line == null)
      return;

    if (Application.isPlaying)
      Destroy(line.gameObject);
    else
      // EditMode tests exercise pool disposal outside Play Mode, where Destroy
      // would only log and defer cleanup.
      DestroyImmediate(line.gameObject);
  }

  private void DisposeLinePool()
  {
    linePool?.Dispose();
    linePool = null;
    linePoolMaxSize = 0;
  }

  private bool IsCandidateVisible(LineCandidate candidate)
  {
    return candidate != null &&
           (visibleNodeIds.Contains(candidate.nodeAId) ||
            visibleNodeIds.Contains(candidate.nodeBId) ||
            candidate.nodeAId.Equals(focusedNodeId) ||
            candidate.nodeBId.Equals(focusedNodeId));
  }

  private bool IsLongLine(LineCandidate candidate)
  {
    if (candidate == null || candidate.transformA == null || candidate.transformB == null)
      return false;

    float maxLongLineDistance = Mathf.Max(0f, longLineDistance);
    if (maxLongLineDistance <= 0f)
      return true;

    return (candidate.transformA.position - candidate.transformB.position).sqrMagnitude >
           maxLongLineDistance * maxLongLineDistance;
  }

  private void UpdateFocusedNodeDirtyState()
  {
    MapGraphNode focusedNode = focusNode != null ? focusNode.SelectedNode : null;
    MapGraphNodeId nextFocusedNodeId = focusedNode != null ? focusedNode.Id : MapGraphNodeId.None;
    if (focusedNodeId.Equals(nextFocusedNodeId))
      return;

    focusedNodeId = nextFocusedNodeId;
    MarkLineSetDirty();
  }

  private void RestyleIncidentActiveLines(MapGraphNodeId nodeId)
  {
    if (!nodeId.IsValid || !candidatesByNodeId.TryGetValue(nodeId, out var candidates))
      return;

    for (int i = 0; i < candidates.Count; i++)
    {
      LineCandidate candidate = candidates[i];
      if (candidate != null &&
          activeLinesByEdgeKey.TryGetValue(candidate.edgeKey, out LineBinding binding) &&
          binding?.line != null)
      {
        ApplyLineStyle(binding.line, IsFocusedLine(binding.candidate));
      }
    }
  }

  private bool IsFocusedLine(LineCandidate candidate)
  {
    return highlightedFocusNodeId.IsValid &&
           candidate != null &&
           (candidate.nodeAId.Equals(highlightedFocusNodeId) ||
            candidate.nodeBId.Equals(highlightedFocusNodeId));
  }

  private void ApplyLineStyle(LineRenderer line, bool focused)
  {
    if (line == null)
      return;

    if (!focused)
    {
      line.SetPropertyBlock(null);
      return;
    }

    focusedLinePropertyBlock ??= new MaterialPropertyBlock();
    focusedLinePropertyBlock.Clear();
    focusedLinePropertyBlock.SetColor(ColorPropertyId, focusedLineColor);
    line.SetPropertyBlock(focusedLinePropertyBlock);
  }
}
