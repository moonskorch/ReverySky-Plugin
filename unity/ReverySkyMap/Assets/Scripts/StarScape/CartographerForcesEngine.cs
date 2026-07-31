using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class CartographerForcesEngine : MonoBehaviour, ICartographerEngine
{
  [Header("Prefabs & Parents")]
  [SerializeField] private StarSO starTemplate;
  [SerializeField] private Transform layoutParent;
  [SerializeField] private TagNodeSO tagNodeTemplate;

  [Header("Layout (force-directed)")]
  [SerializeField, Min(0.5f)] private float idealEdgeLenMin = 4f;
  [SerializeField, Min(0.5f)] private float idealEdgeLenMax = 8f;
  [SerializeField] private float repelStrength = 40f;
  [SerializeField] private float springK = 8f;
  [SerializeField] private float gravityK = 1.0f;
  [SerializeField] private float damping = 0.86f;

  [Header("Dynamic sphere scaling")]
  [SerializeField, Min(0.1f)] private float nodeSpacingFactor = 3.8f;
  [SerializeField, Min(0.1f)] private float minimumBoundRadius = 6f;
  [SerializeField, Range(0.05f, 1f)] private float spawnFillRatio = 0.65f;

  [Header("Visual")]
  [SerializeField] private float tagScale = 0.7f;

  [Header("Line Builder")]
  [SerializeField, Min(0)] private int maxActiveLines = 200;
  [SerializeField, Min(0)] private int maxActiveLongLines = 10;

  [Header("Orbit")]
  [SerializeField] private float orbitAngularSpeed = 0.1f;

  private const int STABLE_SEED = 12345;

  private System.Random _rng;
  private float _boundRadius;

  private readonly List<Node> _nodes = new();
  private readonly List<Edge> _edges = new();
  private readonly List<Edge> _noteLinks = new();

  private readonly List<Star> _stars = new();
  private readonly List<TagNode> _tagNodes = new();

  private struct Node
  {
    public Transform t;
    public Star star;
    public TagNode tagNode;

    public Vector3 v;
    public float mass;
  }

  private struct Edge
  {
    public int noteInd;
    public int tagInd;
    public float restLen;
  }

  public MapLayoutMode EngineType => MapLayoutMode.DynamicLinks;
  public int MaxActiveLines => maxActiveLines;
  public int MaxActiveLongLines => maxActiveLongLines;
  public bool RequiresTick => true;
  public event Action<IReadOnlyList<Star>, IReadOnlyList<TagNode>> OnNodesChanged;

  public float BoundRadius => _boundRadius;
  public Vector3 Pivot => layoutParent ? layoutParent.position : transform.position;
  public ScapeCameraWarper ScapeWarper => null;

  public IReadOnlyList<Star> Stars => _stars;
  public IReadOnlyList<TagNode> TagNodes => _tagNodes;

  private void Awake()
  {
    _rng = new System.Random(STABLE_SEED);
    ResetBoundRadius();
  }

  public void BuildGraph(List<NoteData> notes)
  {
    _rng = new System.Random(STABLE_SEED);

    int noteCount = notes?.Count ?? 0;
    int totalNodeCount = CountPhysicalNodeCount(notes);
    float idealEdgeLen = CalculateIdealEdgeLength(
      noteCount,
      idealEdgeLenMin,
      idealEdgeLenMax,
      Cartographer.I.AutoSwitchThreshold);

    CalculateLayoutRadii(
      totalNodeCount,
      nodeSpacingFactor,
      minimumBoundRadius,
      spawnFillRatio,
      out _boundRadius,
      out float spawnRadius);

    if (notes == null || notes.Count == 0)
    {
      MapRuntimeContext.RequestGraphReady();
      return;
    }

    var tagIndex = new Dictionary<int, int>();

    for (int di = 0; di < notes.Count; di++)
    {
      var data = notes[di];

      var starPos = RandDeterministic(spawnRadius);
      var star = starTemplate.Instantiate(starPos, data, layoutParent);
      _stars.Add(star);

      var noteNode = new Node
      {
        star = star,
        t = star.transform,
        mass = 1f
      };

      int noteIdx = _nodes.Count;
      _nodes.Add(noteNode);

      foreach (var tagId in data.TagIds.Distinct())
      {
        if (!tagIndex.TryGetValue(tagId, out int ti))
        {
          var tag = TagNode.Create(tagNodeTemplate, RandDeterministic(spawnRadius), tagId, layoutParent);
          tag.transform.localScale = Vector3.one * tagScale;
          _tagNodes.Add(tag);

          var tagNode = new Node
          {
            tagNode = tag,
            t = tag.transform,
            mass = 1.4f
          };

          ti = _nodes.Count;
          _nodes.Add(tagNode);
          tagIndex[tagId] = ti;
        }

        _edges.Add(new Edge { noteInd = noteIdx, tagInd = ti, restLen = idealEdgeLen });
      }
    }

    if (MapRuntimeContext.Links != null && MapRuntimeContext.Links.Count > 0)
    {
      var noteIndexById = _nodes
        .Select((node, idx) => new { node, idx })
        .Where(x => x.node.star != null && x.node.star.Data != null && !string.IsNullOrWhiteSpace(x.node.star.Data.Id))
        .GroupBy(x => x.node.star.Data.Id, StringComparer.Ordinal)
        .ToDictionary(g => g.Key, g => g.First().idx, StringComparer.Ordinal);

      var dedup = new HashSet<string>(StringComparer.Ordinal);
      foreach (var link in MapRuntimeContext.Links)
      {
        if (link == null || string.IsNullOrWhiteSpace(link.SourceId) || string.IsNullOrWhiteSpace(link.TargetId))
          continue;

        if (!noteIndexById.TryGetValue(link.SourceId, out var srcIdx))
          continue;
        if (!noteIndexById.TryGetValue(link.TargetId, out var dstIdx))
          continue;
        if (srcIdx == dstIdx)
          continue;

        var a = Mathf.Min(srcIdx, dstIdx);
        var b = Mathf.Max(srcIdx, dstIdx);
        var key = $"{a}:{b}";
        if (!dedup.Add(key))
          continue;

        var weight = link.Weight <= 0f ? 1f : link.Weight;
        _noteLinks.Add(new Edge
        {
          noteInd = srcIdx,
          tagInd = dstIdx,
          restLen = Mathf.Clamp(
            idealEdgeLen / Mathf.Sqrt(weight),
            0.8f,
            idealEdgeLen * 1.5f)
        });
      }
    }

    PublishVisualNodesChanged();
    MapRuntimeContext.RequestGraphReady();
  }

  public void ClearGraph()
  {
    ScapeWarper?.Clear();

    for (int i = 0; i < _nodes.Count; i++)
      if (_nodes[i].t) Destroy(_nodes[i].t.gameObject);

    _nodes.Clear();
    _edges.Clear();
    _noteLinks.Clear();
    _stars.Clear();
    _tagNodes.Clear();
    ResetBoundRadius();
  }

  public void Tick(float dt)
  {
    if (_nodes.Count == 0) return;
    if (!layoutParent) return;

    Vector3 center = layoutParent.position;

    // 1) Repulsion (Coulomb-like)
    for (int i = 0; i < _nodes.Count; i++)
    {
      for (int j = i + 1; j < _nodes.Count; j++)
      {
        var ni = _nodes[i];
        var nj = _nodes[j];

        Vector3 d = nj.t.position - ni.t.position;
        float r2 = Mathf.Max(0.04f, d.sqrMagnitude);
        Vector3 dir = d.normalized;
        float f = repelStrength / r2;
        Vector3 F = dir * f;

        ni.v -= F / ni.mass * dt;
        nj.v += F / nj.mass * dt;

        _nodes[i] = ni;
        _nodes[j] = nj;
      }
    }

    // 2) Springs (Note-Tag)
    for (int k = 0; k < _edges.Count; k++)
    {
      var e = _edges[k];
      var A = _nodes[e.noteInd];
      var B = _nodes[e.tagInd];

      Vector3 d = B.t.position - A.t.position;
      float r = d.magnitude + 1e-4f;
      Vector3 dir = d / r;
      float ext = r - e.restLen;
      Vector3 F = dir * (springK * ext);

      A.v += F / A.mass * dt;
      B.v -= F / B.mass * dt;

      _nodes[e.noteInd] = A;
      _nodes[e.tagInd] = B;
    }

    // 2b) Springs (Note-Note from Obsidian links)
    for (int k = 0; k < _noteLinks.Count; k++)
    {
      var e = _noteLinks[k];
      var A = _nodes[e.noteInd];
      var B = _nodes[e.tagInd];

      Vector3 d = B.t.position - A.t.position;
      float r = d.magnitude + 1e-4f;
      Vector3 dir = d / r;
      float ext = r - e.restLen;
      Vector3 F = dir * (springK * ext);

      A.v += F / A.mass * dt;
      B.v -= F / B.mass * dt;

      _nodes[e.noteInd] = A;
      _nodes[e.tagInd] = B;
    }

    // 3) Gravity to center, orbital, damping, bounds
    for (int i = 0; i < _nodes.Count; i++)
    {
      var n = _nodes[i];

      Vector3 toCenter = center - n.t.position;
      n.v += toCenter * (gravityK * dt);

      if (orbitAngularSpeed > 0f)
      {
        float r = toCenter.magnitude;
        if (r > 1e-3f)
        {
          Vector3 tangent = Vector3.Cross(Vector3.up, toCenter / r);
          n.v += tangent * (orbitAngularSpeed * dt);
        }
      }

      n.v *= damping;
      n.t.position += n.v * dt;

      var lp = n.t.localPosition;
      if (lp.magnitude > _boundRadius)
        n.t.localPosition = lp.normalized * _boundRadius;

      _nodes[i] = n;
    }

  }

  public void ApplyView(ScapeView view)
  {
    bool showTags = (view == ScapeView.Planets);

    for (int i = 0; i < _nodes.Count; i++)
    {
      if (_nodes[i].tagNode != null)
        _nodes[i].tagNode.gameObject.SetActive(showTags);
      if (_nodes[i].star != null)
        _nodes[i].star.SetView(view);
    }
  }

  private void ResetBoundRadius()
  {
    CalculateLayoutRadii(
      totalNodeCount: 0,
      nodeSpacingFactor,
      minimumBoundRadius,
      spawnFillRatio,
      out _boundRadius,
      out _);
  }

  public static void CalculateLayoutRadii(
    int totalNodeCount,
    float nodeSpacingFactor,
    float minimumBoundRadius,
    float spawnFillRatio,
    out float boundRadius,
    out float spawnRadius)
  {
    int safeNodeCount =
      Mathf.Max(1, totalNodeCount);

    float safeNodeSpacingFactor =
      Mathf.Max(0.1f, nodeSpacingFactor);

    float safeMinimumBoundRadius =
      Mathf.Max(0.1f, minimumBoundRadius);

    float safeSpawnFillRatio =
      Mathf.Clamp(spawnFillRatio, 0.05f, 1f);

    boundRadius =
      Mathf.Max(
        safeMinimumBoundRadius,
        safeNodeSpacingFactor *
        Mathf.Pow(safeNodeCount, 1f / 3f));

    spawnRadius =
      boundRadius * safeSpawnFillRatio;
  }

  public static float CalculateIdealEdgeLength(
    int noteCount,
    float minIdealEdgeLen,
    float maxIdealEdgeLen,
    int maxNodeCount)
  {
    int safeMaxNodeCount =
      Mathf.Max(1, maxNodeCount);

    float t =
      Mathf.Clamp01((float)Mathf.Max(0, noteCount) / safeMaxNodeCount);

    return Mathf.Lerp(minIdealEdgeLen, maxIdealEdgeLen, t);
  }

  private static int CountPhysicalNodeCount(
    List<NoteData> notes)
  {
    if (notes == null || notes.Count == 0)
      return 0;

    var uniqueTagIds =
      new HashSet<int>();

    for (int i = 0; i < notes.Count; i++)
    {
      NoteData note = notes[i];
      if (note?.TagIds == null)
        continue;

      foreach (int tagId in note.TagIds)
        uniqueTagIds.Add(tagId);
    }

    return notes.Count + uniqueTagIds.Count;
  }

  private Vector3 RandDeterministic(
    float spawnRadius)
  {
    float x = (float)(_rng.NextDouble() * 2 - 1);
    float y = (float)(_rng.NextDouble() * 2 - 1);
    float z = (float)(_rng.NextDouble() * 2 - 1);
    var v = new Vector3(x, y, z);
    if (v.sqrMagnitude > 1f) v = v.normalized;
    return v * spawnRadius;
  }

  private void PublishVisualNodesChanged()
  {
    OnNodesChanged?.Invoke(_stars, _tagNodes);
  }
}
