using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using UnityEngine;

/// <summary>
/// The visual result looks like random spindle-shaped groups scattered inside a sphere.
/// At 5K, static FPS is 5.
/// Overall: worse than RecursiveHubs both in FPS and in appearance. Rejected.
/// </summary>


// Evaluation target:
// - Target 10K-note maps where performance and spatial air matter more than
//   local link readability.
// - Show macro topics, cluster proportions, and inter-topic relationships.
// - Avoid per-note force simulation, per-note links, and all-node repulsion.
// - Intended first test matrix: 2K, 5K, 10K notes with Normal/Hub/Clusters/Tagless data.
// Assessment:
// - Pending manual evaluation.

/// <summary>
/// Static macro-cluster atlas for very large note graphs.
///
/// The engine compresses notes into a bounded topic graph, lays out that small
/// graph, and then scatters all notes inside sparse galaxy-like clusters. It is
/// designed for the 10K target where the map should read as a cosmos of themes,
/// not as thousands of local force edges.
/// </summary>
[DisallowMultipleComponent]
public class Engine_MacroCosmos10K_v1 : MonoBehaviour, ICartographerEngine
{
  [Header("Prefabs & Parents")]
  [SerializeField] private StarSO starTemplate;
  [SerializeField] private Transform layoutParent;
  [SerializeField] private TagNodeSO tagNodeTemplate;
  [SerializeField] private LineRenderer edgePrefab;

  [Header("Macro clustering")]
  [SerializeField, Range(8, 256)] private int maxMacroClusters = 112;
  [SerializeField, Range(0, 64)] private int tailBucketCount = 12;
  [SerializeField, Min(1)] private int minimumNamedClusterSize = 3;
  [SerializeField, Range(0.25f, 3f)] private float targetClusterCountFactor = 1.15f;
  [SerializeField, Range(1, 16)] private int maxTagsConsideredPerNote = 8;

  [Header("Cosmos scale")]
  [SerializeField, Min(0.1f)] private float galaxySpacingFactor = 11.5f;
  [SerializeField, Min(0.1f)] private float clusterRadiusFactor = 4.4f;
  [SerializeField, Min(0.1f)] private float minimumClusterRadius = 7f;
  [SerializeField, Min(0.1f)] private float minimumBoundRadius = 24f;
  [SerializeField, Range(0.1f, 0.98f)] private float initialClusterSpreadRatio = 0.82f;
  [SerializeField, Range(0.1f, 0.98f)] private float starCloudFillRatio = 0.88f;
  [SerializeField, Range(0.01f, 0.8f)] private float clusterDiskThickness = 0.22f;
  [SerializeField, Range(0f, 8f)] private float spiralTwist = 2.7f;

  [Header("Macro graph layout")]
  [SerializeField, Range(0, 96)] private int clusterLayoutIterations = 28;
  [SerializeField, Range(0f, 1f)] private float clusterLinkPull = 0.13f;
  [SerializeField, Range(0f, 2f)] private float clusterSeparationPush = 0.72f;
  [SerializeField, Min(0.1f)] private float clusterGap = 8f;
  [SerializeField, Min(0.1f)] private float maxClusterMovePerIteration = 3.2f;
  [SerializeField, Range(0f, 0.25f)] private float centerGravity = 0.025f;

  [Header("Visual")]
  [SerializeField, Min(0.01f)] private float topicAnchorScale = 0.86f;
  [SerializeField, Min(0)] private int maxVisibleClusterEdges = 420;
  [SerializeField, Min(0)] private int maxVisibleTopicAnchors = 64;
  [SerializeField, Min(0f)] private float minimumVisibleClusterEdgeWeight = 1.5f;

  private const float GOLDEN_ANGLE_RAD = 2.39996323f;
  private const float GOLDEN_RATIO_CONJUGATE = 0.61803398875f;
  private const float MIN_SQR_DISTANCE = 0.000001f;

  private float _boundRadius;
  private int _noteCount;
  private int _rawClusterCount;

  private readonly List<NoteRecord> _notes = new();
  private readonly List<TopicCluster> _clusters = new();
  private readonly List<ClusterEdge> _clusterEdges = new();
  private readonly List<LineRenderer> _lines = new();
  private readonly List<Star> _stars = new();

  private readonly Dictionary<string, int> _clusterIndexByKey = new(StringComparer.Ordinal);
  private readonly Dictionary<string, int> _noteIndexById = new(StringComparer.Ordinal);
  private readonly Dictionary<long, float> _clusterEdgeWeightsByPair = new();

  private Vector3[] _clusterCorrections = Array.Empty<Vector3>();
  private int[] _clusterCorrectionCounts = Array.Empty<int>();

  private sealed class NoteRecord
  {
    public NoteData Note;
    public string Key;
    public int ClusterIndex = -1;
    public Vector3 LocalPosition;
    public Star Star;
  }

  private sealed class TopicCluster
  {
    public string Key;
    public int TagId = int.MinValue;
    public readonly List<int> Notes = new();
    public Vector3 Center;
    public float Radius;
    public float Score;
    public int StableOrder;
    public TagNode TagNode;
  }

  private readonly struct ClusterEdge
  {
    public readonly int A;
    public readonly int B;
    public readonly float Weight;

    public ClusterEdge(int a, int b, float weight)
    {
      A = a;
      B = b;
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
    _boundRadius = CalculateBoundRadius(0, galaxySpacingFactor, minimumBoundRadius);
  }

  public void Tick(float dt)
  {
    // The macro cosmos is intentionally frozen after BuildGraph().
  }

  public void BuildGraph(List<NoteData> notes)
  {
    var totalStopwatch = Stopwatch.StartNew();

    var clearStopwatch = Stopwatch.StartNew();
    ClearGraph();
    clearStopwatch.Stop();

    var logicalStopwatch = Stopwatch.StartNew();
    BuildNoteRecords(notes);
    logicalStopwatch.Stop();

    if (_noteCount == 0)
    {
      totalStopwatch.Stop();
      UnityEngine.Debug.Log(
        $"[MacroCosmos10K] Built empty graph in {totalStopwatch.Elapsed.TotalMilliseconds:F1} ms. " +
        $"ClearGraphMs={clearStopwatch.Elapsed.TotalMilliseconds:F1}, BuildNotesMs={logicalStopwatch.Elapsed.TotalMilliseconds:F1}");
      return;
    }

    var clusteringStopwatch = Stopwatch.StartNew();
    BuildTopicClusters();
    BuildMacroRelations();
    clusteringStopwatch.Stop();

    var layoutStopwatch = Stopwatch.StartNew();
    PlaceInitialClusters();
    RelaxClusterGraph();
    UpdateBoundRadius();
    PlaceStarsInsideClusters();
    layoutStopwatch.Stop();

    var instantiateNodesStopwatch = Stopwatch.StartNew();
    InstantiateStars();
    InstantiateTopicAnchors();
    instantiateNodesStopwatch.Stop();

    var instantiateLinesStopwatch = Stopwatch.StartNew();
    InstantiateClusterEdges();
    instantiateLinesStopwatch.Stop();

    totalStopwatch.Stop();

    UnityEngine.Debug.Log(
      $"[MacroCosmos10K] Built notes={_noteCount}, rawClusters={_rawClusterCount}, macroClusters={_clusters.Count}, " +
      $"clusterEdges={_clusterEdges.Count}, visibleEdges={_lines.Count}, topicAnchors={CountTopicAnchors()}, " +
      $"boundRadius={_boundRadius:F1}, totalMs={totalStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"ClearGraphMs={clearStopwatch.Elapsed.TotalMilliseconds:F1}, BuildNotesMs={logicalStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"ClusteringMs={clusteringStopwatch.Elapsed.TotalMilliseconds:F1}, LayoutMs={layoutStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"InstantiateNodesMs={instantiateNodesStopwatch.Elapsed.TotalMilliseconds:F1}, InstantiateLinesMs={instantiateLinesStopwatch.Elapsed.TotalMilliseconds:F1}");
  }

  public void ClearGraph()
  {
    for (int i = 0; i < _lines.Count; i++)
      if (_lines[i]) Destroy(_lines[i].gameObject);
    _lines.Clear();

    for (int i = 0; i < _clusters.Count; i++)
      if (_clusters[i].TagNode) Destroy(_clusters[i].TagNode.gameObject);

    for (int i = 0; i < _notes.Count; i++)
      if (_notes[i].Star) Destroy(_notes[i].Star.gameObject);

    _notes.Clear();
    _clusters.Clear();
    _clusterEdges.Clear();
    _stars.Clear();
    _clusterIndexByKey.Clear();
    _noteIndexById.Clear();
    _clusterEdgeWeightsByPair.Clear();

    _clusterCorrections = Array.Empty<Vector3>();
    _clusterCorrectionCounts = Array.Empty<int>();
    _noteCount = 0;
    _rawClusterCount = 0;
    _boundRadius = CalculateBoundRadius(0, galaxySpacingFactor, minimumBoundRadius);
  }

  public void ApplyView(ScapeView view)
  {
    bool showDetails = view == ScapeView.Planets;

    for (int i = 0; i < _notes.Count; i++)
      if (_notes[i].Star != null) _notes[i].Star.SetView(view);

    for (int i = 0; i < _clusters.Count; i++)
      if (_clusters[i].TagNode != null) _clusters[i].TagNode.gameObject.SetActive(showDetails);

    for (int i = 0; i < _lines.Count; i++)
      if (_lines[i] != null) _lines[i].enabled = showDetails;
  }

  public Star FindStarByNoteId(string noteId)
  {
    if (string.IsNullOrEmpty(noteId)) return null;

    if (!_noteIndexById.TryGetValue(noteId, out int noteIndex))
      return null;

    return noteIndex >= 0 && noteIndex < _notes.Count
      ? _notes[noteIndex].Star
      : null;
  }

  public static float CalculateBoundRadius(
    int noteCount,
    float spacingFactor,
    float minimumRadius)
  {
    int safeNoteCount = Mathf.Max(1, noteCount);
    float safeSpacing = Mathf.Max(0.1f, spacingFactor);
    float safeMinimum = Mathf.Max(0.1f, minimumRadius);

    return Mathf.Max(
      safeMinimum,
      safeSpacing * Mathf.Pow(safeNoteCount, 1f / 3f));
  }

  private void BuildNoteRecords(List<NoteData> notes)
  {
    var orderedNotes = (notes ?? new List<NoteData>())
      .Where(note => note != null)
      .OrderBy(NoteKey, StringComparer.Ordinal)
      .ToList();

    _noteCount = orderedNotes.Count;

    for (int i = 0; i < orderedNotes.Count; i++)
    {
      var note = orderedNotes[i];
      var record = new NoteRecord
      {
        Note = note,
        Key = NoteKey(note)
      };

      _notes.Add(record);

      if (!string.IsNullOrWhiteSpace(note.Id) && !_noteIndexById.ContainsKey(note.Id))
        _noteIndexById[note.Id] = i;
    }
  }

  private void BuildTopicClusters()
  {
    var tagFrequencyById = CountTags();
    var rawKeyByNoteIndex = new string[_notes.Count];
    var rawCounts = new Dictionary<string, int>(StringComparer.Ordinal);

    float desiredClusterSize = ResolveDesiredClusterSize();
    for (int noteIndex = 0; noteIndex < _notes.Count; noteIndex++)
    {
      string rawKey = ResolveRawClusterKey(_notes[noteIndex].Note, tagFrequencyById, desiredClusterSize);
      rawKeyByNoteIndex[noteIndex] = rawKey;

      rawCounts.TryGetValue(rawKey, out int count);
      rawCounts[rawKey] = count + 1;
    }

    _rawClusterCount = rawCounts.Count;

    int safeMaxClusters = Mathf.Max(8, maxMacroClusters);
    int safeTailBuckets = Mathf.Clamp(tailBucketCount, 0, Mathf.Max(0, safeMaxClusters - 1));
    int namedClusterBudget = Mathf.Max(1, safeMaxClusters - safeTailBuckets);

    var namedKeys = new HashSet<string>(
      rawCounts
      .Where(pair => pair.Value >= Mathf.Max(1, minimumNamedClusterSize))
      .OrderByDescending(pair => pair.Value)
      .ThenBy(pair => pair.Key, StringComparer.Ordinal)
      .Take(namedClusterBudget)
      .Select(pair => pair.Key),
      StringComparer.Ordinal);

    for (int noteIndex = 0; noteIndex < _notes.Count; noteIndex++)
    {
      string rawKey = rawKeyByNoteIndex[noteIndex];
      string macroKey = namedKeys.Contains(rawKey)
        ? rawKey
        : ResolveTailClusterKey(_notes[noteIndex].Key, safeTailBuckets);

      int clusterIndex = GetOrCreateCluster(macroKey);
      _notes[noteIndex].ClusterIndex = clusterIndex;
      _clusters[clusterIndex].Notes.Add(noteIndex);
    }

    _clusters.Sort((left, right) =>
    {
      int sizeOrder = right.Notes.Count.CompareTo(left.Notes.Count);
      return sizeOrder != 0
        ? sizeOrder
        : string.CompareOrdinal(left.Key, right.Key);
    });

    RebuildClusterIndexAndAssignments();
    ScoreAndSizeClusters();
  }

  private Dictionary<int, int> CountTags()
  {
    var tagFrequencyById = new Dictionary<int, int>();

    for (int noteIndex = 0; noteIndex < _notes.Count; noteIndex++)
    {
      var tagIds = _notes[noteIndex].Note?.TagIds;
      if (tagIds == null || tagIds.Count == 0)
        continue;

      int considered = 0;
      foreach (int tagId in tagIds.Distinct().OrderBy(tagId => tagId))
      {
        if (considered >= Mathf.Max(1, maxTagsConsideredPerNote))
          break;

        tagFrequencyById.TryGetValue(tagId, out int count);
        tagFrequencyById[tagId] = count + 1;
        considered++;
      }
    }

    return tagFrequencyById;
  }

  private float ResolveDesiredClusterSize()
  {
    int desiredClusterCount = Mathf.Clamp(
      Mathf.RoundToInt(Mathf.Sqrt(Mathf.Max(1, _notes.Count)) * targetClusterCountFactor),
      8,
      Mathf.Max(8, maxMacroClusters));

    return Mathf.Max(1f, (float)_notes.Count / desiredClusterCount);
  }

  private string ResolveRawClusterKey(
    NoteData note,
    Dictionary<int, int> tagFrequencyById,
    float desiredClusterSize)
  {
    if (note?.TagIds != null && note.TagIds.Count > 0)
    {
      int bestTagId = int.MinValue;
      float bestScore = float.NegativeInfinity;
      int considered = 0;

      foreach (int tagId in note.TagIds.Distinct().OrderBy(tagId => tagId))
      {
        if (considered >= Mathf.Max(1, maxTagsConsideredPerNote))
          break;

        tagFrequencyById.TryGetValue(tagId, out int frequency);
        float safeFrequency = Mathf.Max(1, frequency);
        float sizeFitness = 1f / (1f + Mathf.Abs(Mathf.Log(safeFrequency / Mathf.Max(1f, desiredClusterSize))));
        float score = Mathf.Sqrt(safeFrequency) * sizeFitness;

        if (score > bestScore)
        {
          bestScore = score;
          bestTagId = tagId;
        }

        considered++;
      }

      if (bestTagId != int.MinValue)
        return $"tag:{bestTagId}";
    }

    string pathTopic = ResolvePathTopic(note?.Path);
    if (!string.IsNullOrEmpty(pathTopic))
      return $"path:{pathTopic}";

    return $"field:{StableHash(NoteKey(note), 29) % 24u:D2}";
  }

  private static string ResolvePathTopic(string path)
  {
    if (string.IsNullOrWhiteSpace(path))
      return string.Empty;

    string normalized = path.Replace('\\', '/').Trim('/');
    if (string.IsNullOrWhiteSpace(normalized))
      return string.Empty;

    int slashIndex = normalized.IndexOf('/');
    return slashIndex <= 0
      ? normalized
      : normalized.Substring(0, slashIndex);
  }

  private static string ResolveTailClusterKey(string noteKey, int safeTailBuckets)
  {
    if (safeTailBuckets <= 0)
      return "tail:00";

    uint bucket = StableHash(noteKey, 43) % (uint)safeTailBuckets;
    return $"tail:{bucket:D2}";
  }

  private int GetOrCreateCluster(string key)
  {
    if (_clusterIndexByKey.TryGetValue(key, out int existingIndex))
      return existingIndex;

    int clusterIndex = _clusters.Count;
    var cluster = new TopicCluster
    {
      Key = key,
      StableOrder = clusterIndex,
      TagId = ParseTagId(key)
    };

    _clusters.Add(cluster);
    _clusterIndexByKey[key] = clusterIndex;
    return clusterIndex;
  }

  private static int ParseTagId(string key)
  {
    if (key == null || !key.StartsWith("tag:", StringComparison.Ordinal))
      return int.MinValue;

    return int.TryParse(key.Substring(4), out int tagId)
      ? tagId
      : int.MinValue;
  }

  private void RebuildClusterIndexAndAssignments()
  {
    _clusterIndexByKey.Clear();

    for (int clusterIndex = 0; clusterIndex < _clusters.Count; clusterIndex++)
    {
      var cluster = _clusters[clusterIndex];
      cluster.StableOrder = clusterIndex;
      _clusterIndexByKey[cluster.Key] = clusterIndex;

      for (int i = 0; i < cluster.Notes.Count; i++)
        _notes[cluster.Notes[i]].ClusterIndex = clusterIndex;
    }
  }

  private void ScoreAndSizeClusters()
  {
    for (int clusterIndex = 0; clusterIndex < _clusters.Count; clusterIndex++)
    {
      var cluster = _clusters[clusterIndex];
      int count = Mathf.Max(1, cluster.Notes.Count);
      cluster.Score = count;
      cluster.Radius = Mathf.Max(
        minimumClusterRadius,
        clusterRadiusFactor * Mathf.Pow(count, 1f / 3f));
    }
  }

  private void BuildMacroRelations()
  {
    AddRuntimeLinkClusterEdges();
    AddTagOverlapClusterEdges();

    _clusterEdges.AddRange(
      _clusterEdgeWeightsByPair
        .Select(pair =>
        {
          DecodePairKey(pair.Key, out int a, out int b);
          return new ClusterEdge(a, b, pair.Value);
        })
        .OrderByDescending(edge => edge.Weight)
        .ThenBy(edge => edge.A)
        .ThenBy(edge => edge.B));
  }

  private void AddRuntimeLinkClusterEdges()
  {
    if (!MapRuntimeContext.IsRuntimeMode || MapRuntimeContext.Links == null)
      return;

    foreach (var link in MapRuntimeContext.Links)
    {
      if (link == null ||
          !_noteIndexById.TryGetValue(link.SourceId ?? string.Empty, out int sourceNoteIndex) ||
          !_noteIndexById.TryGetValue(link.TargetId ?? string.Empty, out int targetNoteIndex))
      {
        continue;
      }

      int sourceCluster = _notes[sourceNoteIndex].ClusterIndex;
      int targetCluster = _notes[targetNoteIndex].ClusterIndex;
      if (sourceCluster < 0 || targetCluster < 0 || sourceCluster == targetCluster)
        continue;

      AddClusterEdgeWeight(sourceCluster, targetCluster, Mathf.Max(1f, link.Weight));
    }
  }

  private void AddTagOverlapClusterEdges()
  {
    int safeMaxTags = Mathf.Max(1, maxTagsConsideredPerNote);

    for (int noteIndex = 0; noteIndex < _notes.Count; noteIndex++)
    {
      var note = _notes[noteIndex].Note;
      if (note?.TagIds == null || note.TagIds.Count == 0)
        continue;

      int sourceCluster = _notes[noteIndex].ClusterIndex;
      if (sourceCluster < 0)
        continue;

      int considered = 0;
      foreach (int tagId in note.TagIds.Distinct().OrderBy(tagId => tagId))
      {
        if (considered >= safeMaxTags)
          break;

        if (_clusterIndexByKey.TryGetValue($"tag:{tagId}", out int tagCluster) &&
            tagCluster != sourceCluster)
        {
          AddClusterEdgeWeight(sourceCluster, tagCluster, 0.22f);
        }

        considered++;
      }
    }
  }

  private void AddClusterEdgeWeight(int left, int right, float weight)
  {
    int a = Mathf.Min(left, right);
    int b = Mathf.Max(left, right);
    long pairKey = PairKey(a, b);

    _clusterEdgeWeightsByPair.TryGetValue(pairKey, out float previousWeight);
    _clusterEdgeWeightsByPair[pairKey] = previousWeight + Mathf.Max(0f, weight);
  }

  private void PlaceInitialClusters()
  {
    _boundRadius = CalculateBoundRadius(_noteCount, galaxySpacingFactor, minimumBoundRadius);
    float spread = _boundRadius * Mathf.Clamp(initialClusterSpreadRatio, 0.1f, 0.98f);

    for (int clusterIndex = 0; clusterIndex < _clusters.Count; clusterIndex++)
    {
      var cluster = _clusters[clusterIndex];
      Vector3 direction = _clusters.Count <= 1
        ? Vector3.zero
        : FibonacciSpherePoint(clusterIndex, _clusters.Count);

      float sizeBias = Mathf.Lerp(
        0.35f,
        1f,
        Mathf.Pow((clusterIndex + 1f) / Mathf.Max(1, _clusters.Count), 0.35f));

      cluster.Center =
        direction * spread * sizeBias +
        StableDirection(cluster.Key, 101) * cluster.Radius * 0.35f;
    }
  }

  private void RelaxClusterGraph()
  {
    int safeIterations = Mathf.Clamp(clusterLayoutIterations, 0, 96);
    if (safeIterations == 0 || _clusters.Count <= 1)
      return;

    EnsureClusterCorrectionBuffers();

    for (int iteration = 0; iteration < safeIterations; iteration++)
    {
      Array.Clear(_clusterCorrections, 0, _clusterCorrections.Length);
      Array.Clear(_clusterCorrectionCounts, 0, _clusterCorrectionCounts.Length);

      ApplyClusterSeparation();
      ApplyClusterLinks();
      ApplyCenterGravity();
      ApplyClusterCorrections();
    }
  }

  private void EnsureClusterCorrectionBuffers()
  {
    if (_clusterCorrections.Length == _clusters.Count &&
        _clusterCorrectionCounts.Length == _clusters.Count)
    {
      return;
    }

    _clusterCorrections = new Vector3[_clusters.Count];
    _clusterCorrectionCounts = new int[_clusters.Count];
  }

  private void ApplyClusterSeparation()
  {
    float push = Mathf.Clamp(clusterSeparationPush, 0f, 2f);
    if (push <= 0f)
      return;

    for (int i = 0; i < _clusters.Count; i++)
    {
      for (int j = i + 1; j < _clusters.Count; j++)
      {
        Vector3 delta = _clusters[j].Center - _clusters[i].Center;
        float distanceSqr = delta.sqrMagnitude;

        Vector3 direction;
        float distance;
        if (distanceSqr <= MIN_SQR_DISTANCE)
        {
          direction = StablePairDirection(i, j, 211);
          distance = 0f;
        }
        else
        {
          distance = Mathf.Sqrt(distanceSqr);
          direction = delta / distance;
        }

        float desiredDistance =
          _clusters[i].Radius +
          _clusters[j].Radius +
          Mathf.Max(0.1f, clusterGap);

        if (distance >= desiredDistance)
          continue;

        Vector3 correction = direction * ((desiredDistance - distance) * 0.5f * push);
        _clusterCorrections[i] -= correction;
        _clusterCorrections[j] += correction;
        _clusterCorrectionCounts[i]++;
        _clusterCorrectionCounts[j]++;
      }
    }
  }

  private void ApplyClusterLinks()
  {
    float pull = Mathf.Clamp01(clusterLinkPull);
    if (pull <= 0f || _clusterEdges.Count == 0)
      return;

    for (int edgeIndex = 0; edgeIndex < _clusterEdges.Count; edgeIndex++)
    {
      var edge = _clusterEdges[edgeIndex];
      var a = _clusters[edge.A];
      var b = _clusters[edge.B];
      Vector3 delta = b.Center - a.Center;
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

      float weightT = Mathf.Clamp01(Mathf.Sqrt(Mathf.Max(0f, edge.Weight)) / 8f);
      float desiredDistance =
        a.Radius +
        b.Radius +
        Mathf.Lerp(clusterGap * 3.2f, clusterGap * 0.95f, weightT);

      float move = Mathf.Clamp(
        (distance - desiredDistance) * pull,
        -Mathf.Max(0.1f, maxClusterMovePerIteration),
        Mathf.Max(0.1f, maxClusterMovePerIteration));

      Vector3 correction = direction * (move * 0.5f);
      _clusterCorrections[edge.A] += correction;
      _clusterCorrections[edge.B] -= correction;
      _clusterCorrectionCounts[edge.A]++;
      _clusterCorrectionCounts[edge.B]++;
    }
  }

  private void ApplyCenterGravity()
  {
    float gravity = Mathf.Clamp(centerGravity, 0f, 0.25f);
    if (gravity <= 0f)
      return;

    for (int clusterIndex = 0; clusterIndex < _clusters.Count; clusterIndex++)
    {
      _clusterCorrections[clusterIndex] += -_clusters[clusterIndex].Center * gravity;
      _clusterCorrectionCounts[clusterIndex]++;
    }
  }

  private void ApplyClusterCorrections()
  {
    float maxMove = Mathf.Max(0.1f, maxClusterMovePerIteration);

    for (int clusterIndex = 0; clusterIndex < _clusters.Count; clusterIndex++)
    {
      int count = _clusterCorrectionCounts[clusterIndex];
      if (count <= 0)
        continue;

      Vector3 correction = _clusterCorrections[clusterIndex] / count;
      if (correction.sqrMagnitude <= MIN_SQR_DISTANCE)
        continue;

      if (correction.magnitude > maxMove)
        correction = correction.normalized * maxMove;

      _clusters[clusterIndex].Center += correction;
    }
  }

  private void UpdateBoundRadius()
  {
    _boundRadius = Mathf.Max(0.1f, minimumBoundRadius);

    for (int clusterIndex = 0; clusterIndex < _clusters.Count; clusterIndex++)
    {
      var cluster = _clusters[clusterIndex];
      _boundRadius = Mathf.Max(
        _boundRadius,
        cluster.Center.magnitude + cluster.Radius + Mathf.Max(0.1f, clusterGap));
    }
  }

  private void PlaceStarsInsideClusters()
  {
    for (int clusterIndex = 0; clusterIndex < _clusters.Count; clusterIndex++)
    {
      var cluster = _clusters[clusterIndex];
      var notes = cluster.Notes
        .OrderBy(noteIndex => _notes[noteIndex].Key, StringComparer.Ordinal)
        .ToList();

      Quaternion rotation = ClusterRotation(cluster.Key);
      float radius = cluster.Radius * Mathf.Clamp(starCloudFillRatio, 0.1f, 0.98f);

      for (int offset = 0; offset < notes.Count; offset++)
      {
        int noteIndex = notes[offset];
        _notes[noteIndex].LocalPosition =
          cluster.Center +
          rotation * GalaxyPoint(offset, notes.Count, _notes[noteIndex].Key, radius);
      }
    }
  }

  private Vector3 GalaxyPoint(int index, int count, string key, float radius)
  {
    if (count <= 1)
      return Vector3.zero;

    float normalized = (index + 0.5f) / count;
    float radial = Mathf.Sqrt(normalized) * radius;
    float angle =
      index * GOLDEN_ANGLE_RAD +
      normalized * Mathf.Max(0f, spiralTwist) +
      Hash01(key, 401) * Mathf.PI * 0.35f;

    float heightScale =
      Mathf.Max(0.01f, clusterDiskThickness) *
      radius *
      Mathf.Lerp(1f, 0.35f, normalized);

    float height = (Hash01(key, 409) * 2f - 1f) * heightScale;
    float armNoise = Mathf.Lerp(0.88f, 1.12f, Hash01(key, 419));

    return new Vector3(
      Mathf.Cos(angle) * radial * armNoise,
      height,
      Mathf.Sin(angle) * radial * armNoise);
  }

  private static Quaternion ClusterRotation(string key)
  {
    Vector3 up = StableDirection(key, 503);
    if (up.sqrMagnitude <= MIN_SQR_DISTANCE)
      up = Vector3.up;

    Quaternion tilt = Quaternion.FromToRotation(Vector3.up, up.normalized);
    Quaternion spin = Quaternion.AngleAxis(Hash01(key, 509) * 360f, up.normalized);
    return spin * tilt;
  }

  private void InstantiateStars()
  {
    if (starTemplate == null)
    {
      UnityEngine.Debug.LogError("[MacroCosmos10K] Missing starTemplate.");
      return;
    }

    for (int noteIndex = 0; noteIndex < _notes.Count; noteIndex++)
    {
      var record = _notes[noteIndex];
      Vector3 worldPosition = layoutParent
        ? layoutParent.TransformPoint(record.LocalPosition)
        : record.LocalPosition;

      record.Star = starTemplate.Instantiate(worldPosition, record.Note, layoutParent);
      if (record.Star != null)
        _stars.Add(record.Star);
    }
  }

  private void InstantiateTopicAnchors()
  {
    if (tagNodeTemplate == null || maxVisibleTopicAnchors <= 0)
      return;

    var tagClusters = _clusters
      .Where(cluster => cluster.TagId != int.MinValue)
      .OrderByDescending(cluster => cluster.Notes.Count)
      .ThenBy(cluster => cluster.Key, StringComparer.Ordinal)
      .Take(Mathf.Max(0, maxVisibleTopicAnchors));

    foreach (var cluster in tagClusters)
    {
      Vector3 worldPosition = layoutParent
        ? layoutParent.TransformPoint(cluster.Center)
        : cluster.Center;

      cluster.TagNode = TagNode.Create(tagNodeTemplate, worldPosition, cluster.TagId, layoutParent);
      if (cluster.TagNode != null)
        cluster.TagNode.transform.localScale = Vector3.one * topicAnchorScale;
    }
  }

  private void InstantiateClusterEdges()
  {
    if (edgePrefab == null || maxVisibleClusterEdges <= 0)
      return;

    int safeBudget = Mathf.Max(0, maxVisibleClusterEdges);
    var visibleEdges = _clusterEdges
      .Where(edge => edge.Weight >= Mathf.Max(0f, minimumVisibleClusterEdgeWeight))
      .OrderByDescending(edge => edge.Weight)
      .ThenBy(edge => edge.A)
      .ThenBy(edge => edge.B)
      .Take(safeBudget);

    foreach (var edge in visibleEdges)
    {
      Vector3 a = ToWorldPosition(_clusters[edge.A].Center);
      Vector3 b = ToWorldPosition(_clusters[edge.B].Center);

      var line = Instantiate(edgePrefab, layoutParent);
      line.positionCount = 2;
      line.SetPosition(0, a);
      line.SetPosition(1, b);
      _lines.Add(line);
    }
  }

  private Vector3 ToWorldPosition(Vector3 localPosition)
  {
    return layoutParent
      ? layoutParent.TransformPoint(localPosition)
      : localPosition;
  }

  private int CountTopicAnchors()
  {
    int count = 0;
    for (int i = 0; i < _clusters.Count; i++)
      if (_clusters[i].TagNode != null)
        count++;

    return count;
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
