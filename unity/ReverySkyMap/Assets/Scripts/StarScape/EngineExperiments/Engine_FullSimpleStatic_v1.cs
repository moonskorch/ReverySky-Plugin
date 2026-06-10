using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

// Evaluation:
// - Visually, nodes are arranged too much like a grid, even though there is some positional variation.
// - The map remains fairly sparse overall, but in tagless cases it collapses into a congested clump.
// - It is slightly more structural and compact than Engine_EmptySpheres.
// [Cartographer] Graph built in 474,5 ms (notes=2000, engine=StaticLinks)
// Assessment:
// - Engine_EmptySpheres is already a better and more finished version of this direction in almost every respect.
// - Further investment in this variant is not justified.


/// <summary>
/// Static link-based map for medium and large graphs.
/// Builds positions once from tags and direct note links, then freezes the map.
/// </summary>
public class Engine_FullSimpleStatic_v1 : MonoBehaviour, ICartographerEngine
{
  [Header("Prefabs & Parents")]
  [SerializeField] private StarSO starTemplate;
  [SerializeField] private Transform layoutParent;
  [SerializeField] private TagNodeSO tagNodeTemplate;
  [SerializeField] private LineRenderer edgePrefab;

  [Header("Dynamic sphere scaling")]
  [SerializeField, Min(0.1f)] private float nodeSpacingFactor = 3.8f;
  [SerializeField, Min(0.1f)] private float minimumBoundRadius = 6f;

  [Header("Static links layout")]
  [SerializeField, Range(0.05f, 0.95f)] private float componentSpreadRatio = 0.62f;
  [SerializeField, Range(0.05f, 0.95f)] private float tagSpreadRatio = 0.48f;
  [SerializeField, Min(0.1f)] private float noteSpacing = 1.8f;
  [SerializeField, Range(0f, 1f)] private float linkPull = 0.25f;
  [SerializeField, Range(0, 8)] private int linkRelaxationPasses = 2;
  [SerializeField, Range(1, 128)] private int maxPackingAttempts = 32;

  [Header("Visual")]
  [SerializeField] private float tagScale = 0.7f;
  [SerializeField, Min(0)] private int maxVisibleEdges = 1500;

  private const float GOLDEN_ANGLE_RAD = 2.39996323f;
  private const float MAX_LAYOUT_LINK_WEIGHT = 4f;

  private float _boundRadius;
  private int _noteCount;

  private readonly List<Node> _nodes = new();
  private readonly List<Edge> _tagEdges = new();
  private readonly List<Edge> _noteLinks = new();
  private readonly List<LineRenderer> _lines = new();
  private readonly List<Star> _stars = new();

  private List<int>[] _tagNodesByNote = Array.Empty<List<int>>();
  private Vector3[] _componentCenterByNode = Array.Empty<Vector3>();

  private sealed class Node
  {
    public bool IsNote;
    public NoteData Note;
    public int TagId;
    public int TagFrequency;
    public string Key;
    public Vector3 LocalPosition;
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

  private struct Edge
  {
    public int A;
    public int B;
    public float Weight;
  }

  private sealed class Component
  {
    public readonly List<int> Nodes = new();
    public readonly List<int> Tags = new();
    public string Key;
    public Vector3 Center;
  }

  public CartographerEngine EngineType => CartographerEngine.StaticLinks;
  public bool RequiresTick => false;
  public void Tick(float dt) { }

  public float BoundRadius => _boundRadius;
  public Vector3 Pivot => layoutParent ? layoutParent.position : transform.position;
  public ScapeCameraWarper ScapeWarper => null;
  public IReadOnlyList<Star> Stars => _stars;

  private void Awake()
  {
    _boundRadius = CalculateBoundRadius(0, nodeSpacingFactor, minimumBoundRadius);
  }

  public void BuildGraph(List<NoteData> notes)
  {
    ClearGraph();
    BuildLogicalGraph(notes);

    _boundRadius = CalculateBoundRadius(
      _nodes.Count,
      nodeSpacingFactor,
      minimumBoundRadius);

    if (_noteCount == 0)
      return;

    var components = FindConnectedComponents();
    PlaceTagAnchors(components);
    PlaceNotes();
    RelaxDirectLinks();
    SpreadCrowdedNotes();
    InstantiateNodes();
    InstantiateLines();

    Debug.Log(
      $"[CartographerStaticLinks] Built notes={_noteCount}, tags={_nodes.Count - _noteCount}, " +
      $"tagEdges={_tagEdges.Count}, noteLinks={_noteLinks.Count}, visibleEdges={_lines.Count}, " +
      $"components={components.Count}, boundRadius={_boundRadius:F1}");
  }

  public void ClearGraph()
  {
    for (int i = 0; i < _lines.Count; i++)
      if (_lines[i]) Destroy(_lines[i].gameObject);
    _lines.Clear();

    for (int i = 0; i < _nodes.Count; i++)
    {
      var tr = _nodes[i].VisualTransform;
      if (tr) Destroy(tr.gameObject);
    }

    _nodes.Clear();
    _tagEdges.Clear();
    _noteLinks.Clear();
    _stars.Clear();
    _tagNodesByNote = Array.Empty<List<int>>();
    _componentCenterByNode = Array.Empty<Vector3>();
    _noteCount = 0;
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
    float nodeSpacingFactor,
    float minimumBoundRadius)
  {
    int safeNodeCount = Mathf.Max(1, totalNodeCount);
    float safeSpacing = Mathf.Max(0.1f, nodeSpacingFactor);
    float safeMinimum = Mathf.Max(0.1f, minimumBoundRadius);

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
    _tagNodesByNote = new List<int>[_noteCount];

    var tagIdsByNote = new List<int>[_noteCount];
    var tagFrequency = new Dictionary<int, int>();

    for (int noteIndex = 0; noteIndex < _noteCount; noteIndex++)
    {
      var note = orderedNotes[noteIndex];
      var tagIds = (note.TagIds ?? new List<int>())
        .Distinct()
        .OrderBy(tagId => tagId)
        .ToList();

      tagIdsByNote[noteIndex] = tagIds;
      _tagNodesByNote[noteIndex] = new List<int>(tagIds.Count);
      _nodes.Add(new Node { IsNote = true, Note = note, Key = NoteKey(note) });

      for (int i = 0; i < tagIds.Count; i++)
      {
        tagFrequency.TryGetValue(tagIds[i], out int count);
        tagFrequency[tagIds[i]] = count + 1;
      }
    }

    var tagNodeById = new Dictionary<int, int>();
    foreach (int tagId in tagFrequency.Keys.OrderBy(tagId => tagId))
    {
      tagNodeById[tagId] = _nodes.Count;
      _nodes.Add(new Node
      {
        IsNote = false,
        TagId = tagId,
        TagFrequency = tagFrequency[tagId],
        Key = $"tag:{tagId}"
      });
    }

    for (int noteIndex = 0; noteIndex < _noteCount; noteIndex++)
    {
      for (int i = 0; i < tagIdsByNote[noteIndex].Count; i++)
      {
        int tagNodeIndex = tagNodeById[tagIdsByNote[noteIndex][i]];
        _tagNodesByNote[noteIndex].Add(tagNodeIndex);
        _tagEdges.Add(new Edge { A = noteIndex, B = tagNodeIndex, Weight = 1f });
      }
    }

    BuildDirectLinks();
    _componentCenterByNode = new Vector3[_nodes.Count];
  }

  private void BuildDirectLinks()
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

    var weightsByPair = new Dictionary<long, float>();
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
      long pair = PairKey(a, b);
      float weight = link.Weight > 0f ? link.Weight : 1f;

      if (!weightsByPair.TryGetValue(pair, out float previous) || weight > previous)
        weightsByPair[pair] = weight;
    }

    foreach (var pair in weightsByPair.OrderBy(pair => pair.Key))
    {
      DecodePairKey(pair.Key, out int a, out int b);
      _noteLinks.Add(new Edge { A = a, B = b, Weight = pair.Value });
    }
  }

  private List<Component> FindConnectedComponents()
  {
    var adjacency = new List<int>[_nodes.Count];
    for (int i = 0; i < adjacency.Length; i++)
      adjacency[i] = new List<int>();

    AddToAdjacency(_tagEdges, adjacency);
    AddToAdjacency(_noteLinks, adjacency);

    var components = new List<Component>();
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
        if (!_nodes[nodeIndex].IsNote) component.Tags.Add(nodeIndex);

        for (int i = 0; i < adjacency[nodeIndex].Count; i++)
        {
          int neighbor = adjacency[nodeIndex][i];
          if (visited[neighbor]) continue;
          visited[neighbor] = true;
          queue.Enqueue(neighbor);
        }
      }

      component.Nodes.Sort(CompareNodeKeys);
      component.Tags.Sort(CompareNodeKeys);
      component.Key = _nodes[component.Nodes[0]].Key;
      components.Add(component);
    }

    return components
      .OrderByDescending(component => component.Nodes.Count)
      .ThenBy(component => component.Key, StringComparer.Ordinal)
      .ToList();
  }

  private static void AddToAdjacency(List<Edge> edges, List<int>[] adjacency)
  {
    for (int i = 0; i < edges.Count; i++)
    {
      adjacency[edges[i].A].Add(edges[i].B);
      adjacency[edges[i].B].Add(edges[i].A);
    }
  }

  private void PlaceTagAnchors(List<Component> components)
  {
    float componentSpread = _boundRadius * Mathf.Clamp(componentSpreadRatio, 0.05f, 0.95f);

    for (int componentIndex = 0; componentIndex < components.Count; componentIndex++)
    {
      var component = components[componentIndex];
      component.Center = componentIndex == 0
        ? Vector3.zero
        : FibonacciBallPoint(componentIndex - 1, components.Count - 1) * componentSpread;

      for (int i = 0; i < component.Nodes.Count; i++)
        _componentCenterByNode[component.Nodes[i]] = component.Center;

      float localSpread = Mathf.Min(
        _boundRadius * 0.55f,
        Mathf.Max(
          noteSpacing * 2f,
          nodeSpacingFactor * Mathf.Pow(Mathf.Max(1, component.Nodes.Count), 1f / 3f) * tagSpreadRatio));

      for (int tagOffset = 0; tagOffset < component.Tags.Count; tagOffset++)
      {
        int tagNodeIndex = component.Tags[tagOffset];
        Vector3 offset = component.Tags.Count <= 1
          ? Vector3.zero
          : FibonacciBallPoint(tagOffset, component.Tags.Count) * localSpread;

        _nodes[tagNodeIndex].LocalPosition = ClampToSphere(component.Center + offset, noteSpacing * 0.5f);
      }
    }
  }

  private void PlaceNotes()
  {
    for (int noteIndex = 0; noteIndex < _noteCount; noteIndex++)
    {
      var node = _nodes[noteIndex];
      var tags = _tagNodesByNote[noteIndex];
      Vector3 basePosition = _componentCenterByNode[noteIndex];

      if (tags.Count > 0)
      {
        Vector3 weightedSum = Vector3.zero;
        float totalWeight = 0f;

        for (int i = 0; i < tags.Count; i++)
        {
          var tagNode = _nodes[tags[i]];
          float weight = 1f / Mathf.Sqrt(Mathf.Max(1, tagNode.TagFrequency));
          weightedSum += tagNode.LocalPosition * weight;
          totalWeight += weight;
        }

        if (totalWeight > 0f)
          basePosition = weightedSum / totalWeight;
      }

      float jitterScale = Mathf.Lerp(0.75f, 1.65f, Hash01(node.Key, 19));
      Vector3 jitter = StableDirection(node.Key, 31) * noteSpacing * jitterScale;
      node.LocalPosition = ClampToSphere(basePosition + jitter, noteSpacing * 0.5f);
    }
  }

  private void RelaxDirectLinks()
  {
    int passes = Mathf.Clamp(linkRelaxationPasses, 0, 8);
    float pull = Mathf.Clamp01(linkPull);
    if (passes == 0 || pull <= 0f || _noteLinks.Count == 0) return;

    var weightedSums = new Vector3[_noteCount];
    var totalWeights = new float[_noteCount];
    var next = new Vector3[_noteCount];

    for (int pass = 0; pass < passes; pass++)
    {
      Array.Clear(weightedSums, 0, weightedSums.Length);
      Array.Clear(totalWeights, 0, totalWeights.Length);

      for (int i = 0; i < _noteLinks.Count; i++)
      {
        var edge = _noteLinks[i];
        float weight = Mathf.Clamp(edge.Weight, 0.25f, MAX_LAYOUT_LINK_WEIGHT);
        weightedSums[edge.A] += _nodes[edge.B].LocalPosition * weight;
        weightedSums[edge.B] += _nodes[edge.A].LocalPosition * weight;
        totalWeights[edge.A] += weight;
        totalWeights[edge.B] += weight;
      }

      for (int noteIndex = 0; noteIndex < _noteCount; noteIndex++)
      {
        Vector3 current = _nodes[noteIndex].LocalPosition;
        next[noteIndex] = totalWeights[noteIndex] <= 0f
          ? current
          : ClampToSphere(
            Vector3.Lerp(current, weightedSums[noteIndex] / totalWeights[noteIndex], pull),
            noteSpacing * 0.5f);
      }

      for (int noteIndex = 0; noteIndex < _noteCount; noteIndex++)
        _nodes[noteIndex].LocalPosition = next[noteIndex];
    }
  }

  private void SpreadCrowdedNotes()
  {
    float cellSize = Mathf.Max(0.1f, noteSpacing);
    var offsets = BuildPackingOffsets(Mathf.Clamp(maxPackingAttempts, 1, 128));
    var occupied = new HashSet<Vector3Int>();

    for (int nodeIndex = _noteCount; nodeIndex < _nodes.Count; nodeIndex++)
      occupied.Add(ToCell(_nodes[nodeIndex].LocalPosition, cellSize));

    for (int noteIndex = 0; noteIndex < _noteCount; noteIndex++)
    {
      var node = _nodes[noteIndex];
      Vector3 target = ClampToSphere(node.LocalPosition, cellSize * 0.5f);
      Vector3Int origin = ToCell(target, cellSize);
      int shift = offsets.Count > 1
        ? (int)(StableHash(node.Key, 73) % (uint)(offsets.Count - 1))
        : 0;

      for (int attempt = 0; attempt < offsets.Count; attempt++)
      {
        Vector3Int offset = attempt == 0
          ? Vector3Int.zero
          : offsets[1 + ((attempt - 1 + shift) % (offsets.Count - 1))];
        Vector3Int cell = origin + offset;
        Vector3 center = CellCenter(cell, cellSize);

        if (occupied.Contains(cell) || !IsInsideSphere(center, cellSize * 0.5f))
          continue;

        occupied.Add(cell);
        node.LocalPosition = ClampToSphere(
          center + StableDirection(node.Key, 97) * cellSize * 0.12f,
          cellSize * 0.25f);
        break;
      }
    }
  }

  private void InstantiateNodes()
  {
    if (starTemplate == null)
    {
      Debug.LogError("[CartographerStaticLinks] Missing starTemplate.");
      return;
    }

    bool canCreateTags = tagNodeTemplate != null;
    if (!canCreateTags && _nodes.Count > _noteCount)
      Debug.LogWarning("[CartographerStaticLinks] Missing tagNodeTemplate. Tag nodes were skipped.");

    for (int nodeIndex = 0; nodeIndex < _nodes.Count; nodeIndex++)
    {
      var node = _nodes[nodeIndex];
      Vector3 worldPosition = layoutParent
        ? layoutParent.TransformPoint(node.LocalPosition)
        : node.LocalPosition;

      if (node.IsNote)
      {
        node.Star = starTemplate.Instantiate(worldPosition, node.Note, layoutParent);
        if (node.Star != null) _stars.Add(node.Star);
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
    if (edgePrefab == null || maxVisibleEdges <= 0) return;

    int noteLinkBudget = Mathf.Min(_noteLinks.Count, maxVisibleEdges / 2);
    var visibleEdges = _noteLinks
      .OrderByDescending(edge => edge.Weight)
      .ThenBy(edge => edge.A)
      .ThenBy(edge => edge.B)
      .Take(noteLinkBudget)
      .Concat(_tagEdges.OrderBy(edge => edge.A).ThenBy(edge => edge.B))
      .Concat(_noteLinks
        .OrderByDescending(edge => edge.Weight)
        .ThenBy(edge => edge.A)
        .ThenBy(edge => edge.B)
        .Skip(noteLinkBudget))
      .Take(maxVisibleEdges);

    foreach (var edge in visibleEdges)
    {
      var a = _nodes[edge.A].VisualTransform;
      var b = _nodes[edge.B].VisualTransform;
      if (!a || !b) continue;

      var line = Instantiate(edgePrefab, layoutParent);
      line.positionCount = 2;
      line.SetPosition(0, a.position);
      line.SetPosition(1, b.position);
      _lines.Add(line);
    }
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

  private bool IsInsideSphere(Vector3 position, float margin)
  {
    float radius = Mathf.Max(0.01f, _boundRadius - Mathf.Max(0f, margin));
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
            if (shell > 0 && Mathf.Max(Mathf.Abs(x), Mathf.Max(Mathf.Abs(y), Mathf.Abs(z))) != shell)
              continue;
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
    return new Vector3Int(
      Mathf.RoundToInt(position.x / cellSize),
      Mathf.RoundToInt(position.y / cellSize),
      Mathf.RoundToInt(position.z / cellSize));
  }

  private static Vector3 CellCenter(Vector3Int cell, float cellSize)
  {
    return new Vector3(cell.x * cellSize, cell.y * cellSize, cell.z * cellSize);
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
