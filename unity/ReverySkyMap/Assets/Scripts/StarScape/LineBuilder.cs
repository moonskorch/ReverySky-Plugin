using System;
using System.Collections.Generic;
using UnityEngine;

// TODO:
// 1. Purge long lines with limits.
// 2. Pooling of lines.
// 3. Limits of lines in engines.
// 4. Focus node priority to show.
// 5. Remove line building from engine.
// 6. Limit per node.
// 7. Per-frame budget for line activation/deactivation.
// 8. Reconciliation: rebuild active lines from all visible nodes by priority, instead of keeping the lines that filled the limit first.

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
  [SerializeField, Min(1)] private int maxActiveLines = 200;

  private readonly Dictionary<Component, string> endpointByNode = new();
  private readonly Dictionary<string, Transform> transformByEndpoint = new(StringComparer.Ordinal);
  private readonly Dictionary<string, List<LineCandidate>> candidatesByEndpoint = new(StringComparer.Ordinal);
  private readonly Dictionary<string, LineBinding> activeLinesByEdgeKey = new(StringComparer.Ordinal);
  private readonly HashSet<string> edgeKeys = new(StringComparer.Ordinal);
  private readonly HashSet<string> visibleEndpoints = new(StringComparer.Ordinal);
  private readonly List<string> staleLineKeys = new();

  public void Rebuild()
  {
    Rebuild(null, null);
  }

  public void Rebuild(IReadOnlyList<Star> stars, IReadOnlyList<TagNode> tagNodes)
  {
    ClearActiveLines();
    endpointByNode.Clear();
    transformByEndpoint.Clear();
    candidatesByEndpoint.Clear();
    edgeKeys.Clear();
    visibleEndpoints.Clear();

    RegisterStarEndpoints(stars);
    RegisterTagEndpoints(tagNodes);
    BuildNoteNoteCandidates();
    BuildNoteTagCandidates(stars);
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

    if (activeLinesByEdgeKey.Count >= maxActiveLines)
      return;

    if (linePrefab == null)
      return;

    Transform parent = lineParent != null ? lineParent : transform;
    LineRenderer line = Instantiate(linePrefab, parent);
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

    if (binding?.line != null)
      Destroy(binding.line.gameObject);

    activeLinesByEdgeKey.Remove(edgeKey);
  }

  private void ClearActiveLines()
  {
    foreach (var pair in activeLinesByEdgeKey)
    {
      LineBinding binding = pair.Value;
      if (binding?.line != null)
        Destroy(binding.line.gameObject);
    }

    activeLinesByEdgeKey.Clear();
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
