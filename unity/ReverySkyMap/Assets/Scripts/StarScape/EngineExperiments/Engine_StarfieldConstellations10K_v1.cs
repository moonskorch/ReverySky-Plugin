using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using UnityEngine;

/// <summary>
/// The visual result looks like a random sparse distribution of identical patches across the surface of a hollow sphere.
/// At 5K, static FPS is 5.
/// At 10K, FPS is 2.
/// [Cartographer] Graph built in 1354,6 ms (notes=5000, engine=StaticLinks)
/// [Cartographer] Graph built in 2490,6 ms (notes=10000, engine=StaticLinks)
/// Overall: worse than RecursiveHubs both in FPS and in appearance. Rejected.
/// </summary>


// Evaluation target:
// - Target 10K-note maps with a "star map / night sky" feel.
// - Show macro themes as constellations on a celestial sphere.
// - Keep local note links hidden; show only large constellation relationships.
// - Prioritize BuildGraph performance and spatial readability over force accuracy.
// Assessment:
// - Pending manual evaluation against Engine_MacroCosmos10K_v1 and Engine_RecursiveHubs_v3.

/// <summary>
/// Static constellation atlas for very large note graphs.
///
/// Notes are grouped into bounded macro topics, topics become constellations on
/// a sky sphere, and notes are scattered as sparse stars inside each angular
/// patch. Only the strongest topic-topic relations are drawn.
/// </summary>
[DisallowMultipleComponent]
public class Engine_StarfieldConstellations10K_v1 : MonoBehaviour, ICartographerEngine
{
  [Header("Prefabs & Parents")]
  [SerializeField] private StarSO starTemplate;
  [SerializeField] private Transform layoutParent;
  [SerializeField] private TagNodeSO tagNodeTemplate;
  [SerializeField] private LineRenderer edgePrefab;

  [Header("Constellation clustering")]
  [SerializeField, Range(8, 256)] private int maxConstellations = 128;
  [SerializeField, Range(0, 64)] private int tailConstellationCount = 16;
  [SerializeField, Min(1)] private int minimumNamedConstellationSize = 3;
  [SerializeField, Range(0.25f, 3f)] private float targetConstellationCountFactor = 1.25f;
  [SerializeField, Range(1, 16)] private int maxTagsConsideredPerNote = 8;

  [Header("Sky geometry")]
  [SerializeField, Min(0.1f)] private float skyRadiusFactor = 18f;
  [SerializeField, Min(0.1f)] private float minimumSkyRadius = 44f;
  [SerializeField, Min(0.1f)] private float skyPadding = 18f;
  [SerializeField, Range(1f, 25f)] private float minimumAngularRadiusDegrees = 2.6f;
  [SerializeField, Range(1f, 35f)] private float maximumAngularRadiusDegrees = 10f;
  [SerializeField, Range(0f, 0.35f)] private float depthVariationRatio = 0.08f;
  [SerializeField, Range(0.1f, 0.98f)] private float starPatchFillRatio = 0.9f;
  [SerializeField, Range(0f, 8f)] private float spiralTwist = 1.8f;

  [Header("Constellation layout")]
  [SerializeField, Range(0, 96)] private int constellationLayoutIterations = 24;
  [SerializeField, Range(0f, 1f)] private float relationPull = 0.08f;
  [SerializeField, Range(0f, 2f)] private float angularSeparationPush = 0.9f;
  [SerializeField, Range(0f, 20f)] private float minimumAngularGapDegrees = 2.8f;
  [SerializeField, Range(0.001f, 0.25f)] private float maxDirectionMovePerIteration = 0.035f;

  [Header("Visual")]
  [SerializeField, Min(0.01f)] private float topicAnchorScale = 0.78f;
  [SerializeField, Min(0)] private int maxVisibleConstellationEdges = 360;
  [SerializeField, Min(0)] private int maxVisibleTopicAnchors = 72;
  [SerializeField, Min(0f)] private float minimumVisibleRelationWeight = 1.5f;

  private const float GOLDEN_ANGLE_RAD = 2.39996323f;
  private const float GOLDEN_RATIO_CONJUGATE = 0.61803398875f;
  private const float MIN_SQR_DISTANCE = 0.000001f;

  private float _skyRadius;
  private float _boundRadius;
  private int _noteCount;
  private int _rawClusterCount;

  private readonly List<NoteRecord> _notes = new();
  private readonly List<Constellation> _constellations = new();
  private readonly List<ConstellationEdge> _constellationEdges = new();
  private readonly List<LineRenderer> _lines = new();
  private readonly List<Star> _stars = new();

  private readonly Dictionary<string, int> _constellationIndexByKey = new(StringComparer.Ordinal);
  private readonly Dictionary<string, int> _noteIndexById = new(StringComparer.Ordinal);
  private readonly Dictionary<long, float> _relationWeightsByPair = new();

  private Vector3[] _directionCorrections = Array.Empty<Vector3>();
  private int[] _directionCorrectionCounts = Array.Empty<int>();

  private sealed class NoteRecord
  {
    public NoteData Note;
    public string Key;
    public int ConstellationIndex = -1;
    public Vector3 LocalPosition;
    public Star Star;
  }

  private sealed class Constellation
  {
    public string Key;
    public int TagId = int.MinValue;
    public readonly List<int> Notes = new();
    public Vector3 Direction = Vector3.forward;
    public Vector3 Center;
    public float AngularRadius;
    public float DepthOffset;
    public int StableOrder;
    public TagNode TagNode;
  }

  private readonly struct ConstellationEdge
  {
    public readonly int A;
    public readonly int B;
    public readonly float Weight;

    public ConstellationEdge(int a, int b, float weight)
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
    _skyRadius = CalculateSkyRadius(0, skyRadiusFactor, minimumSkyRadius);
    _boundRadius = _skyRadius + Mathf.Max(0.1f, skyPadding);
  }

  public void Tick(float dt)
  {
    // The constellation map is intentionally frozen after BuildGraph().
  }

  public void BuildGraph(List<NoteData> notes)
  {
    var totalStopwatch = Stopwatch.StartNew();

    var clearStopwatch = Stopwatch.StartNew();
    ClearGraph();
    clearStopwatch.Stop();

    var notesStopwatch = Stopwatch.StartNew();
    BuildNoteRecords(notes);
    notesStopwatch.Stop();

    if (_noteCount == 0)
    {
      totalStopwatch.Stop();
      UnityEngine.Debug.Log(
        $"[StarfieldConstellations10K] Built empty graph in {totalStopwatch.Elapsed.TotalMilliseconds:F1} ms. " +
        $"ClearGraphMs={clearStopwatch.Elapsed.TotalMilliseconds:F1}, BuildNotesMs={notesStopwatch.Elapsed.TotalMilliseconds:F1}");
      return;
    }

    var clusteringStopwatch = Stopwatch.StartNew();
    BuildConstellations();
    BuildConstellationRelations();
    clusteringStopwatch.Stop();

    var layoutStopwatch = Stopwatch.StartNew();
    PlaceInitialConstellations();
    RelaxConstellationDirections();
    UpdateSkyBounds();
    PlaceStars();
    layoutStopwatch.Stop();

    var instantiateNodesStopwatch = Stopwatch.StartNew();
    InstantiateStars();
    InstantiateTopicAnchors();
    instantiateNodesStopwatch.Stop();

    var instantiateLinesStopwatch = Stopwatch.StartNew();
    InstantiateConstellationEdges();
    instantiateLinesStopwatch.Stop();

    totalStopwatch.Stop();

    UnityEngine.Debug.Log(
      $"[StarfieldConstellations10K] Built notes={_noteCount}, rawClusters={_rawClusterCount}, " +
      $"constellations={_constellations.Count}, relations={_constellationEdges.Count}, " +
      $"visibleEdges={_lines.Count}, topicAnchors={CountTopicAnchors()}, skyRadius={_skyRadius:F1}, " +
      $"boundRadius={_boundRadius:F1}, totalMs={totalStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"ClearGraphMs={clearStopwatch.Elapsed.TotalMilliseconds:F1}, BuildNotesMs={notesStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"ClusteringMs={clusteringStopwatch.Elapsed.TotalMilliseconds:F1}, LayoutMs={layoutStopwatch.Elapsed.TotalMilliseconds:F1}, " +
      $"InstantiateNodesMs={instantiateNodesStopwatch.Elapsed.TotalMilliseconds:F1}, InstantiateLinesMs={instantiateLinesStopwatch.Elapsed.TotalMilliseconds:F1}");
  }

  public void ClearGraph()
  {
    for (int i = 0; i < _lines.Count; i++)
      if (_lines[i]) Destroy(_lines[i].gameObject);
    _lines.Clear();

    for (int i = 0; i < _constellations.Count; i++)
      if (_constellations[i].TagNode) Destroy(_constellations[i].TagNode.gameObject);

    for (int i = 0; i < _notes.Count; i++)
      if (_notes[i].Star) Destroy(_notes[i].Star.gameObject);

    _notes.Clear();
    _constellations.Clear();
    _constellationEdges.Clear();
    _lines.Clear();
    _stars.Clear();
    _constellationIndexByKey.Clear();
    _noteIndexById.Clear();
    _relationWeightsByPair.Clear();

    _directionCorrections = Array.Empty<Vector3>();
    _directionCorrectionCounts = Array.Empty<int>();
    _noteCount = 0;
    _rawClusterCount = 0;
    _skyRadius = CalculateSkyRadius(0, skyRadiusFactor, minimumSkyRadius);
    _boundRadius = _skyRadius + Mathf.Max(0.1f, skyPadding);
  }

  public void ApplyView(ScapeView view)
  {
    bool showDetails = view == ScapeView.Planets;

    for (int i = 0; i < _notes.Count; i++)
      if (_notes[i].Star != null) _notes[i].Star.SetView(view);

    for (int i = 0; i < _constellations.Count; i++)
      if (_constellations[i].TagNode != null) _constellations[i].TagNode.gameObject.SetActive(showDetails);

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

  public static float CalculateSkyRadius(
    int noteCount,
    float radiusFactor,
    float minimumRadius)
  {
    int safeNoteCount = Mathf.Max(1, noteCount);
    float safeFactor = Mathf.Max(0.1f, radiusFactor);
    float safeMinimum = Mathf.Max(0.1f, minimumRadius);

    return Mathf.Max(
      safeMinimum,
      safeFactor * Mathf.Pow(safeNoteCount, 1f / 3f));
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
      _notes.Add(new NoteRecord
      {
        Note = note,
        Key = NoteKey(note)
      });

      if (!string.IsNullOrWhiteSpace(note.Id) && !_noteIndexById.ContainsKey(note.Id))
        _noteIndexById[note.Id] = i;
    }
  }

  private void BuildConstellations()
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

    int safeMaxConstellations = Mathf.Max(8, maxConstellations);
    int safeTailCount = Mathf.Clamp(tailConstellationCount, 0, Mathf.Max(0, safeMaxConstellations - 1));
    int namedBudget = Mathf.Max(1, safeMaxConstellations - safeTailCount);

    var namedKeys = new HashSet<string>(
      rawCounts
        .Where(pair => pair.Value >= Mathf.Max(1, minimumNamedConstellationSize))
        .OrderByDescending(pair => pair.Value)
        .ThenBy(pair => pair.Key, StringComparer.Ordinal)
        .Take(namedBudget)
        .Select(pair => pair.Key),
      StringComparer.Ordinal);

    for (int noteIndex = 0; noteIndex < _notes.Count; noteIndex++)
    {
      string rawKey = rawKeyByNoteIndex[noteIndex];
      string constellationKey = namedKeys.Contains(rawKey)
        ? rawKey
        : ResolveTailClusterKey(_notes[noteIndex].Key, safeTailCount);

      int constellationIndex = GetOrCreateConstellation(constellationKey);
      _notes[noteIndex].ConstellationIndex = constellationIndex;
      _constellations[constellationIndex].Notes.Add(noteIndex);
    }

    _constellations.Sort((left, right) =>
    {
      int sizeOrder = right.Notes.Count.CompareTo(left.Notes.Count);
      return sizeOrder != 0
        ? sizeOrder
        : string.CompareOrdinal(left.Key, right.Key);
    });

    RebuildConstellationIndexAndAssignments();
    SizeConstellations();
  }

  private Dictionary<int, int> CountTags()
  {
    var tagFrequencyById = new Dictionary<int, int>();
    int safeMaxTags = Mathf.Max(1, maxTagsConsideredPerNote);

    for (int noteIndex = 0; noteIndex < _notes.Count; noteIndex++)
    {
      var tags = _notes[noteIndex].Note?.TagIds;
      if (tags == null || tags.Count == 0)
        continue;

      int considered = 0;
      foreach (int tagId in tags.Distinct().OrderBy(tagId => tagId))
      {
        if (considered >= safeMaxTags)
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
      Mathf.RoundToInt(Mathf.Sqrt(Mathf.Max(1, _notes.Count)) * targetConstellationCountFactor),
      8,
      Mathf.Max(8, maxConstellations));

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

    return $"field:{StableHash(NoteKey(note), 29) % 32u:D2}";
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

  private static string ResolveTailClusterKey(string noteKey, int safeTailCount)
  {
    if (safeTailCount <= 0)
      return "tail:00";

    uint bucket = StableHash(noteKey, 43) % (uint)safeTailCount;
    return $"tail:{bucket:D2}";
  }

  private int GetOrCreateConstellation(string key)
  {
    if (_constellationIndexByKey.TryGetValue(key, out int existingIndex))
      return existingIndex;

    int index = _constellations.Count;
    var constellation = new Constellation
    {
      Key = key,
      StableOrder = index,
      TagId = ParseTagId(key)
    };

    _constellations.Add(constellation);
    _constellationIndexByKey[key] = index;
    return index;
  }

  private static int ParseTagId(string key)
  {
    if (key == null || !key.StartsWith("tag:", StringComparison.Ordinal))
      return int.MinValue;

    return int.TryParse(key.Substring(4), out int tagId)
      ? tagId
      : int.MinValue;
  }

  private void RebuildConstellationIndexAndAssignments()
  {
    _constellationIndexByKey.Clear();

    for (int constellationIndex = 0; constellationIndex < _constellations.Count; constellationIndex++)
    {
      var constellation = _constellations[constellationIndex];
      constellation.StableOrder = constellationIndex;
      _constellationIndexByKey[constellation.Key] = constellationIndex;

      for (int i = 0; i < constellation.Notes.Count; i++)
        _notes[constellation.Notes[i]].ConstellationIndex = constellationIndex;
    }
  }

  private void SizeConstellations()
  {
    int largestCount = 1;
    for (int i = 0; i < _constellations.Count; i++)
      largestCount = Mathf.Max(largestCount, _constellations[i].Notes.Count);

    float minAngle = minimumAngularRadiusDegrees * Mathf.Deg2Rad;
    float maxAngle = Mathf.Max(minAngle, maximumAngularRadiusDegrees * Mathf.Deg2Rad);

    for (int constellationIndex = 0; constellationIndex < _constellations.Count; constellationIndex++)
    {
      var constellation = _constellations[constellationIndex];
      float sizeT = Mathf.Pow((float)constellation.Notes.Count / largestCount, 1f / 3f);
      constellation.AngularRadius = Mathf.Lerp(minAngle, maxAngle, sizeT);
      constellation.DepthOffset = (Hash01(constellation.Key, 73) * 2f - 1f) * depthVariationRatio;
    }
  }

  private void BuildConstellationRelations()
  {
    AddRuntimeLinkRelations();
    AddTagOverlapRelations();

    _constellationEdges.AddRange(
      _relationWeightsByPair
        .Select(pair =>
        {
          DecodePairKey(pair.Key, out int a, out int b);
          return new ConstellationEdge(a, b, pair.Value);
        })
        .OrderByDescending(edge => edge.Weight)
        .ThenBy(edge => edge.A)
        .ThenBy(edge => edge.B));
  }

  private void AddRuntimeLinkRelations()
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

      int sourceConstellation = _notes[sourceNoteIndex].ConstellationIndex;
      int targetConstellation = _notes[targetNoteIndex].ConstellationIndex;
      if (sourceConstellation < 0 || targetConstellation < 0 || sourceConstellation == targetConstellation)
        continue;

      AddRelationWeight(sourceConstellation, targetConstellation, Mathf.Max(1f, link.Weight));
    }
  }

  private void AddTagOverlapRelations()
  {
    int safeMaxTags = Mathf.Max(1, maxTagsConsideredPerNote);

    for (int noteIndex = 0; noteIndex < _notes.Count; noteIndex++)
    {
      var note = _notes[noteIndex].Note;
      if (note?.TagIds == null || note.TagIds.Count == 0)
        continue;

      int sourceConstellation = _notes[noteIndex].ConstellationIndex;
      if (sourceConstellation < 0)
        continue;

      int considered = 0;
      foreach (int tagId in note.TagIds.Distinct().OrderBy(tagId => tagId))
      {
        if (considered >= safeMaxTags)
          break;

        if (_constellationIndexByKey.TryGetValue($"tag:{tagId}", out int tagConstellation) &&
            tagConstellation != sourceConstellation)
        {
          AddRelationWeight(sourceConstellation, tagConstellation, 0.2f);
        }

        considered++;
      }
    }
  }

  private void AddRelationWeight(int left, int right, float weight)
  {
    int a = Mathf.Min(left, right);
    int b = Mathf.Max(left, right);
    long pairKey = PairKey(a, b);

    _relationWeightsByPair.TryGetValue(pairKey, out float previousWeight);
    _relationWeightsByPair[pairKey] = previousWeight + Mathf.Max(0f, weight);
  }

  private void PlaceInitialConstellations()
  {
    _skyRadius = CalculateSkyRadius(_noteCount, skyRadiusFactor, minimumSkyRadius);

    for (int constellationIndex = 0; constellationIndex < _constellations.Count; constellationIndex++)
    {
      Vector3 direction = _constellations.Count <= 1
        ? Vector3.forward
        : FibonacciSpherePoint(constellationIndex, _constellations.Count);

      direction += StableDirection(_constellations[constellationIndex].Key, 101) * 0.08f;
      _constellations[constellationIndex].Direction = direction.normalized;
    }
  }

  private void RelaxConstellationDirections()
  {
    int safeIterations = Mathf.Clamp(constellationLayoutIterations, 0, 96);
    if (safeIterations == 0 || _constellations.Count <= 1)
    {
      UpdateConstellationCenters();
      return;
    }

    EnsureDirectionCorrectionBuffers();

    for (int iteration = 0; iteration < safeIterations; iteration++)
    {
      Array.Clear(_directionCorrections, 0, _directionCorrections.Length);
      Array.Clear(_directionCorrectionCounts, 0, _directionCorrectionCounts.Length);

      ApplyAngularSeparation();
      ApplyRelationPull();
      ApplyDirectionCorrections();
    }

    UpdateConstellationCenters();
  }

  private void EnsureDirectionCorrectionBuffers()
  {
    if (_directionCorrections.Length == _constellations.Count &&
        _directionCorrectionCounts.Length == _constellations.Count)
    {
      return;
    }

    _directionCorrections = new Vector3[_constellations.Count];
    _directionCorrectionCounts = new int[_constellations.Count];
  }

  private void ApplyAngularSeparation()
  {
    float push = Mathf.Clamp(angularSeparationPush, 0f, 2f);
    if (push <= 0f)
      return;

    float gap = minimumAngularGapDegrees * Mathf.Deg2Rad;

    for (int i = 0; i < _constellations.Count; i++)
    {
      for (int j = i + 1; j < _constellations.Count; j++)
      {
        Vector3 a = _constellations[i].Direction;
        Vector3 b = _constellations[j].Direction;
        float angle = Mathf.Acos(Mathf.Clamp(Vector3.Dot(a, b), -1f, 1f));
        float desiredAngle = _constellations[i].AngularRadius + _constellations[j].AngularRadius + gap;

        if (angle >= desiredAngle)
          continue;

        Vector3 direction = (b - a);
        if (direction.sqrMagnitude <= MIN_SQR_DISTANCE)
          direction = StablePairDirection(i, j, 211);

        Vector3 correction = direction.normalized * ((desiredAngle - angle) * push);
        _directionCorrections[i] -= correction;
        _directionCorrections[j] += correction;
        _directionCorrectionCounts[i]++;
        _directionCorrectionCounts[j]++;
      }
    }
  }

  private void ApplyRelationPull()
  {
    float pull = Mathf.Clamp01(relationPull);
    if (pull <= 0f || _constellationEdges.Count == 0)
      return;

    for (int edgeIndex = 0; edgeIndex < _constellationEdges.Count; edgeIndex++)
    {
      var edge = _constellationEdges[edgeIndex];
      Vector3 a = _constellations[edge.A].Direction;
      Vector3 b = _constellations[edge.B].Direction;
      float weightT = Mathf.Clamp01(Mathf.Sqrt(Mathf.Max(0f, edge.Weight)) / 8f);
      float desiredAngle = Mathf.Lerp(1.15f, 0.32f, weightT);
      float angle = Mathf.Acos(Mathf.Clamp(Vector3.Dot(a, b), -1f, 1f));
      float move = Mathf.Clamp(
        (angle - desiredAngle) * pull,
        -maxDirectionMovePerIteration,
        maxDirectionMovePerIteration);

      Vector3 direction = (b - a);
      if (direction.sqrMagnitude <= MIN_SQR_DISTANCE)
        direction = StablePairDirection(edge.A, edge.B, 307);

      Vector3 correction = direction.normalized * (move * 0.5f);
      _directionCorrections[edge.A] += correction;
      _directionCorrections[edge.B] -= correction;
      _directionCorrectionCounts[edge.A]++;
      _directionCorrectionCounts[edge.B]++;
    }
  }

  private void ApplyDirectionCorrections()
  {
    float maxMove = Mathf.Max(0.001f, maxDirectionMovePerIteration);

    for (int i = 0; i < _constellations.Count; i++)
    {
      int count = _directionCorrectionCounts[i];
      if (count <= 0)
        continue;

      Vector3 correction = _directionCorrections[i] / count;
      if (correction.sqrMagnitude <= MIN_SQR_DISTANCE)
        continue;

      if (correction.magnitude > maxMove)
        correction = correction.normalized * maxMove;

      Vector3 next = _constellations[i].Direction + correction;
      if (next.sqrMagnitude <= MIN_SQR_DISTANCE)
        next = StableDirection(_constellations[i].Key, 409);

      _constellations[i].Direction = next.normalized;
    }
  }

  private void UpdateConstellationCenters()
  {
    for (int i = 0; i < _constellations.Count; i++)
    {
      var constellation = _constellations[i];
      float distance = _skyRadius * (1f + constellation.DepthOffset);
      constellation.Center = constellation.Direction * distance;
    }
  }

  private void UpdateSkyBounds()
  {
    _boundRadius = _skyRadius + Mathf.Max(0.1f, skyPadding);

    for (int i = 0; i < _constellations.Count; i++)
    {
      var constellation = _constellations[i];
      float patchRadius = Mathf.Sin(constellation.AngularRadius) * _skyRadius;
      _boundRadius = Mathf.Max(
        _boundRadius,
        constellation.Center.magnitude + patchRadius + Mathf.Max(0.1f, skyPadding));
    }
  }

  private void PlaceStars()
  {
    for (int constellationIndex = 0; constellationIndex < _constellations.Count; constellationIndex++)
    {
      var constellation = _constellations[constellationIndex];
      var noteIndices = constellation.Notes
        .OrderBy(noteIndex => _notes[noteIndex].Key, StringComparer.Ordinal)
        .ToList();

      BuildTangentBasis(constellation.Direction, out Vector3 tangentU, out Vector3 tangentV);

      for (int offset = 0; offset < noteIndices.Count; offset++)
      {
        int noteIndex = noteIndices[offset];
        _notes[noteIndex].LocalPosition = ResolveStarPosition(
          constellation,
          tangentU,
          tangentV,
          offset,
          noteIndices.Count,
          _notes[noteIndex].Key);
      }
    }
  }

  private Vector3 ResolveStarPosition(
    Constellation constellation,
    Vector3 tangentU,
    Vector3 tangentV,
    int offset,
    int count,
    string key)
  {
    if (count <= 1)
      return constellation.Center;

    float normalized = (offset + 0.5f) / count;
    float patchRadius = constellation.AngularRadius * Mathf.Clamp(starPatchFillRatio, 0.1f, 0.98f);
    float radialAngle = Mathf.Sqrt(normalized) * patchRadius;
    float angle =
      offset * GOLDEN_ANGLE_RAD +
      normalized * spiralTwist +
      Hash01(key, 601) * Mathf.PI * 0.5f;

    float armNoise = Mathf.Lerp(0.84f, 1.16f, Hash01(key, 607));
    Vector3 tangentOffset =
      tangentU * Mathf.Cos(angle) * radialAngle * armNoise +
      tangentV * Mathf.Sin(angle) * radialAngle * armNoise;

    Vector3 direction = (constellation.Direction + tangentOffset).normalized;
    float depth =
      (Hash01(key, 613) * 2f - 1f) *
      _skyRadius *
      Mathf.Clamp(depthVariationRatio, 0f, 0.35f);

    return direction * Mathf.Max(0.1f, _skyRadius + depth);
  }

  private static void BuildTangentBasis(Vector3 direction, out Vector3 tangentU, out Vector3 tangentV)
  {
    Vector3 safeDirection = direction.sqrMagnitude <= MIN_SQR_DISTANCE
      ? Vector3.forward
      : direction.normalized;

    Vector3 reference = Mathf.Abs(Vector3.Dot(safeDirection, Vector3.up)) > 0.92f
      ? Vector3.right
      : Vector3.up;

    tangentU = Vector3.Cross(reference, safeDirection).normalized;
    tangentV = Vector3.Cross(safeDirection, tangentU).normalized;
  }

  private void InstantiateStars()
  {
    if (starTemplate == null)
    {
      UnityEngine.Debug.LogError("[StarfieldConstellations10K] Missing starTemplate.");
      return;
    }

    for (int noteIndex = 0; noteIndex < _notes.Count; noteIndex++)
    {
      var record = _notes[noteIndex];
      Vector3 worldPosition = ToWorldPosition(record.LocalPosition);
      record.Star = starTemplate.Instantiate(worldPosition, record.Note, layoutParent);

      if (record.Star != null)
        _stars.Add(record.Star);
    }
  }

  private void InstantiateTopicAnchors()
  {
    if (tagNodeTemplate == null || maxVisibleTopicAnchors <= 0)
      return;

    var tagConstellations = _constellations
      .Where(constellation => constellation.TagId != int.MinValue)
      .OrderByDescending(constellation => constellation.Notes.Count)
      .ThenBy(constellation => constellation.Key, StringComparer.Ordinal)
      .Take(Mathf.Max(0, maxVisibleTopicAnchors));

    foreach (var constellation in tagConstellations)
    {
      constellation.TagNode = TagNode.Create(
        tagNodeTemplate,
        ToWorldPosition(constellation.Center),
        constellation.TagId,
        layoutParent);

      if (constellation.TagNode != null)
        constellation.TagNode.transform.localScale = Vector3.one * topicAnchorScale;
    }
  }

  private void InstantiateConstellationEdges()
  {
    if (edgePrefab == null || maxVisibleConstellationEdges <= 0)
      return;

    int safeBudget = Mathf.Max(0, maxVisibleConstellationEdges);
    var visibleEdges = _constellationEdges
      .Where(edge => edge.Weight >= Mathf.Max(0f, minimumVisibleRelationWeight))
      .OrderByDescending(edge => edge.Weight)
      .ThenBy(edge => edge.A)
      .ThenBy(edge => edge.B)
      .Take(safeBudget);

    foreach (var edge in visibleEdges)
    {
      var line = Instantiate(edgePrefab, layoutParent);
      line.positionCount = 2;
      line.SetPosition(0, ToWorldPosition(_constellations[edge.A].Center));
      line.SetPosition(1, ToWorldPosition(_constellations[edge.B].Center));
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
    for (int i = 0; i < _constellations.Count; i++)
      if (_constellations[i].TagNode != null)
        count++;

    return count;
  }

  private static Vector3 FibonacciSpherePoint(int index, int count)
  {
    if (count <= 1)
      return Vector3.forward;

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
