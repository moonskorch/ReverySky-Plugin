using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Pool;

// TODO:
// 1. Purge long lines with limits.
// 2. Focus node priority to show.
// 3. Remove line building from engine.
// 4. Limit per node.
// 5. Per-frame budget for line activation/deactivation.
// 6. Reconciliation: rebuild active lines from all visible nodes by priority, instead of keeping the lines that filled the limit first.

/// <summary>
/// Builds culling-driven edge visuals for the active graph nodes.
/// Physical line renderers are pooled because visibility changes can be frequent while graph data stays stable.
/// </summary>
public sealed class LineBuilder : MonoBehaviour, ICullingConsumer
{
  private const string NoteEndpointPrefix = "note:";
  private const string TagEndpointPrefix = "tag:";

  private sealed class LineCandidate
  {
    public string edgeKey;
    public string endpointA;
    public string endpointB;
    public Transform transformA;
    public Transform transformB;
  }

  private sealed class LineBinding
  {
    public LineRenderer line;
    public Transform transformA;
    public Transform transformB;
  }

  [SerializeField] private LineRenderer linePrefab;
  [SerializeField] private Transform lineParent;
  [SerializeField, Min(0.01f)] private float radius = 1f;
  [SerializeField, Min(0.01f)] private float visibleDistance = 80f;

  private readonly Dictionary<Component, string> endpointByNode = new();
  private readonly Dictionary<string, Transform> transformByEndpoint = new(StringComparer.Ordinal);
  private readonly Dictionary<string, List<LineCandidate>> candidatesByEndpoint = new(StringComparer.Ordinal);
  private readonly Dictionary<string, LineBinding> activeLinesByEdgeKey = new(StringComparer.Ordinal);
  private readonly HashSet<string> edgeKeys = new(StringComparer.Ordinal);
  private readonly HashSet<string> visibleEndpoints = new(StringComparer.Ordinal);
  private readonly List<string> staleLineKeys = new();
  private ObjectPool<LineRenderer> linePool;
  private int activeLineLimit;
  private int linePoolMaxSize;

  public void Rebuild(IReadOnlyList<Star> stars, IReadOnlyList<TagNode> tagNodes, int maxActiveLines)
  {
    activeLineLimit = Mathf.Max(0, maxActiveLines);
    // Release active lines before resizing so the old pool owns all inactive renderers it may dispose.
    ClearActiveLines();
    ClearLineState();
    EnsureLinePoolSize(activeLineLimit);

    if (activeLineLimit == 0)
      return;

    RegisterStarEndpoints(stars);
    RegisterTagEndpoints(tagNodes);
    BuildNoteNoteCandidates();
    BuildNoteTagCandidates(stars);
  }

  private void OnDestroy()
  {
    ClearActiveLines();
    DisposeLinePool();
    ClearLineState();
  }

  private void ClearLineState()
  {
    endpointByNode.Clear();
    transformByEndpoint.Clear();
    candidatesByEndpoint.Clear();
    edgeKeys.Clear();
    visibleEndpoints.Clear();
  }

  public bool TryCreateDistanceEntry(Component node, out CullingManager.Entry entry)
  {
    entry = null;

    if (node == null || !endpointByNode.ContainsKey(node))
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
    if (node == null || !endpointByNode.TryGetValue(node, out string endpoint))
      return;

    if (visible)
    {
      if (!visibleEndpoints.Add(endpoint))
        return;

      ShowCandidateLines(endpoint);
      return;
    }

    if (!visibleEndpoints.Remove(endpoint))
      return;

    HideUnneededCandidateLines(endpoint);
  }

  private void LateUpdate()
  {
    staleLineKeys.Clear();
    if (activeLineLimit == 0 || activeLinesByEdgeKey.Count == 0)
      return;

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

  private void RegisterStarEndpoints(IReadOnlyList<Star> stars)
  {
    if (stars == null)
      return;

    for (int i = 0; i < stars.Count; i++)
    {
      Star star = stars[i];
      if (star == null || star.Data == null || string.IsNullOrWhiteSpace(star.Data.Id))
        continue;

      RegisterEndpoint(star, NoteEndpoint(star.Data.Id));
    }
  }

  private void RegisterTagEndpoints(IReadOnlyList<TagNode> tagNodes)
  {
    if (tagNodes == null)
      return;

    for (int i = 0; i < tagNodes.Count; i++)
    {
      TagNode tagNode = tagNodes[i];
      if (tagNode == null)
        continue;

      RegisterEndpoint(tagNode, TagEndpoint(tagNode.UserTagId));
    }
  }

  private void RegisterEndpoint(Component node, string endpoint)
  {
    if (node == null || string.IsNullOrWhiteSpace(endpoint) || transformByEndpoint.ContainsKey(endpoint))
      return;

    endpointByNode[node] = endpoint;
    transformByEndpoint[endpoint] = node.transform;
    EnsureCandidateList(endpoint);
  }

  private void BuildNoteNoteCandidates()
  {
    if (MapRuntimeContext.Links == null)
      return;

    foreach (var link in MapRuntimeContext.Links)
    {
      if (link == null ||
          string.IsNullOrWhiteSpace(link.SourceId) ||
          string.IsNullOrWhiteSpace(link.TargetId) ||
          string.Equals(link.SourceId, link.TargetId, StringComparison.Ordinal))
      {
        continue;
      }

      TryAddCandidate(NoteEndpoint(link.SourceId), NoteEndpoint(link.TargetId));
    }
  }

  private void BuildNoteTagCandidates(IReadOnlyList<Star> stars)
  {
    if (stars == null)
      return;

    for (int i = 0; i < stars.Count; i++)
    {
      Star star = stars[i];
      if (star == null || star.Data == null || star.Data.TagIds == null ||
          !endpointByNode.TryGetValue(star, out string noteEndpoint))
      {
        continue;
      }

      for (int tagIndex = 0; tagIndex < star.Data.TagIds.Count; tagIndex++)
        TryAddCandidate(noteEndpoint, TagEndpoint(star.Data.TagIds[tagIndex]));
    }
  }

  private void TryAddCandidate(string endpointA, string endpointB)
  {
    if (string.Equals(endpointA, endpointB, StringComparison.Ordinal) ||
        !transformByEndpoint.TryGetValue(endpointA, out Transform transformA) ||
        !transformByEndpoint.TryGetValue(endpointB, out Transform transformB))
    {
      return;
    }

    string edgeKey = EdgeKey(endpointA, endpointB);
    if (!edgeKeys.Add(edgeKey))
      return;

    var candidate = new LineCandidate
    {
      edgeKey = edgeKey,
      endpointA = endpointA,
      endpointB = endpointB,
      transformA = transformA,
      transformB = transformB
    };

    EnsureCandidateList(endpointA).Add(candidate);
    EnsureCandidateList(endpointB).Add(candidate);
  }

  private List<LineCandidate> EnsureCandidateList(string endpoint)
  {
    if (!candidatesByEndpoint.TryGetValue(endpoint, out var candidates))
    {
      candidates = new List<LineCandidate>();
      candidatesByEndpoint[endpoint] = candidates;
    }

    return candidates;
  }

  private void ShowCandidateLines(string endpoint)
  {
    if (!candidatesByEndpoint.TryGetValue(endpoint, out var candidates))
      return;

    for (int i = 0; i < candidates.Count; i++)
      ShowLine(candidates[i]);
  }

  private void HideUnneededCandidateLines(string endpoint)
  {
    if (!candidatesByEndpoint.TryGetValue(endpoint, out var candidates))
      return;

    for (int i = 0; i < candidates.Count; i++)
    {
      LineCandidate candidate = candidates[i];
      if (visibleEndpoints.Contains(OtherEndpoint(candidate, endpoint)))
        continue;

      RemoveLine(candidate.edgeKey);
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
    line.SetPosition(0, candidate.transformA.position);
    line.SetPosition(1, candidate.transformB.position);

    activeLinesByEdgeKey[candidate.edgeKey] = new LineBinding
    {
      line = line,
      transformA = candidate.transformA,
      transformB = candidate.transformB
    };
  }

  private void RemoveLine(string edgeKey)
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

  private static void PrepareLineForPool(LineRenderer line)
  {
    if (line == null)
      return;

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

  private static string OtherEndpoint(LineCandidate candidate, string endpoint)
  {
    return string.Equals(candidate.endpointA, endpoint, StringComparison.Ordinal)
      ? candidate.endpointB
      : candidate.endpointA;
  }

  private static string EdgeKey(string endpointA, string endpointB)
  {
    return string.CompareOrdinal(endpointA, endpointB) <= 0
      ? $"{endpointA}|{endpointB}"
      : $"{endpointB}|{endpointA}";
  }

  private static string NoteEndpoint(string noteId)
  {
    return $"{NoteEndpointPrefix}{noteId}";
  }

  private static string TagEndpoint(int tagId)
  {
    return $"{TagEndpointPrefix}{tagId}";
  }
}
