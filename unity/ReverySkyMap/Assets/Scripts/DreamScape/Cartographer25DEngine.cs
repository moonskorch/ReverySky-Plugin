using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

// TODO
// Add date labels along the axis
// Add radial movement for note nodes
// Add LOD logic, preferrably in Star Visual
// Set camera start at the newest star
public class Cartographer25DEngine : MonoBehaviour, ICartographerEngine
{
  [Header("Prefabs & Parents")]
  [SerializeField] private StarSO starTemplate;
  [SerializeField] private Transform layoutParent;
  [SerializeField] private ScapeCameraWarper scapeWarper;

  [Header("Chain Layout (XY)")]
  [Tooltip("XY distance between consecutive days in the chain")]
  [SerializeField] private float chainStepDistance = 4.0f;

  [Tooltip("Vertical spacing for multiple notes on the same day (up OR down)")]
  [SerializeField] private float sameDateStackDistance = 2.2f;

  [Tooltip("Maximum number of notes on the same date that may stay in one vertical stack")]
  [SerializeField, Min(1)] private int maxSameDateVerticalNotes = 5;

  [Range(0f, 180f)]
  [Tooltip("Max random turn (deg) when stepping the chain to the next day")]
  [SerializeField] private float chainTurnMaxDeg = 110f;

  [Header("Note Depth (Date -> Z)")]
  [SerializeField] private float dateDepthRange = 200f;
  [SerializeField] private float depthPerDay = 0.7f;
  [SerializeField] private bool olderNotesAreFar = true;

  [Header("Bounds")]
  [SerializeField] private float boundXYRadius = 10f;
  [SerializeField] private bool clampZToRange = true;

  private const int STABLE_SEED = 12345;

  private readonly List<Node> _nodes = new();
  private readonly List<Star> _stars = new();

  private struct Node
  {
    public Transform t;
    public Star star;

    public float radius;
    public Vector2 noteAnchorXY;
  }

  public CartographerEngine EngineType => CartographerEngine.Static25D;
  public bool RequiresTick => false;
  public void Tick(float dt) { }

  public float BoundRadius => boundXYRadius;
  public Vector3 Pivot => layoutParent ? layoutParent.position : transform.position;

  public ScapeCameraWarper ScapeWarper => scapeWarper;

  public IReadOnlyList<Star> Stars => _stars;

  public float ZMin => -dateDepthRange * 0.5f;
  public float ZMax => dateDepthRange * 0.5f;

  public event Action<float, float> OnDateAxisRangeChanged;

  public void BuildGraph(List<NoteData> notes)
  {
    ClearGraph();
    if (notes == null || notes.Count == 0) return;

    // small same-day groups -> vertical if fits
    // groups above maxSameDateVerticalNotes -> XY chain with virtual-day Z steps
    var ordered = notes.OrderBy(d => d.DateTime).ToList();

    int extraVirtualDays = 0;
    int sentinelExtraVirtualDays = 0;
    DateTime minDate = DateTime.MinValue;
    DateTime maxDate = DateTime.MinValue;
    bool hasRegularDates = false;

    int scan = 0;
    while (scan < ordered.Count)
    {
      var day = ordered[scan].DateTime.Date;
      int start = scan;
      bool isSentinel = IsMinimumDateSentinel(ordered[start]);

      while (scan < ordered.Count && ordered[scan].DateTime.Date == day)
        scan++;

      int count = scan - start;
      int extra = count > maxSameDateVerticalNotes ? count - 1 : 0;
      extraVirtualDays += extra;

      if (isSentinel)
        sentinelExtraVirtualDays = extra;
      else
      {
        if (!hasRegularDates)
        {
          minDate = ordered[start].DateTime;
          hasRegularDates = true;
        }

        maxDate = ordered[scan - 1].DateTime;
      }
    }

    float dateRangeDays = Mathf.Max(0f, (float)(maxDate - minDate).TotalDays);
    float totalVirtualDays = dateRangeDays + extraVirtualDays;
    dateDepthRange = Mathf.Max(0.01f, depthPerDay * totalVirtualDays);
    OnDateAxisRangeChanged?.Invoke(ZMin, ZMax);

    var rng = new System.Random(STABLE_SEED);

    // local space of layoutParent: tube is just a circle with radius boundXYRadius
    Vector2 cur = Vector2.zero;
    Vector2 dir = Rotate2(Vector2.right, RandomRange(rng, 0f, 360f) * Mathf.Deg2Rad).normalized;

    bool hasPrev = false;
    int insertedRegularVirtualDaysBefore = 0;

    int idx = 0;
    while (idx < ordered.Count)
    {
      var day = ordered[idx].DateTime.Date;

      int start = idx;
      while (idx < ordered.Count && ordered[idx].DateTime.Date == day) idx++;
      int count = idx - start;
      bool isSentinel = IsMinimumDateSentinel(ordered[start]);
      bool useVirtualChain = count > maxSameDateVerticalNotes;
      float virtualDay = VirtualDayByDate(
        ordered[start],
        minDate,
        sentinelExtraVirtualDays,
        insertedRegularVirtualDaysBefore);

      if (isSentinel && useVirtualChain)
      {
        for (int k = count - 1; k >= 0; k--)
        {
          if (k < count - 1)
            cur = StepChainLocal(cur, ref dir, rng);

          float sentinelVirtualDay = sentinelExtraVirtualDays - k;

          PlaceNoteLocal(
            ordered[start + k],
            cur,
            sentinelVirtualDay,
            totalVirtualDays);
        }

        hasPrev = true;
        continue;
      }

      if (hasPrev)
        cur = StepChainLocal(cur, ref dir, rng);

      if (!isSentinel && useVirtualChain)
      {
        float baseVirtualDay = VirtualDayByDate(
          ordered[start],
          minDate,
          sentinelExtraVirtualDays,
          insertedRegularVirtualDaysBefore);

        for (int k = 0; k < count; k++)
        {
          if (k > 0)
            cur = StepChainLocal(cur, ref dir, rng);

          PlaceNoteLocal(
            ordered[start + k],
            cur,
            baseVirtualDay + k,
            totalVirtualDays);
        }

        insertedRegularVirtualDaysBefore += count - 1;
        hasPrev = true;
        continue;
      }

      PlaceNoteLocal(ordered[start], cur, virtualDay, totalVirtualDays);

      if (count > 1)
      {
        float sign = DayStackSign(day);

        if (TryPlaceDayVerticalLocal(ordered, start, count, cur, sign, virtualDay, totalVirtualDays, out var last))
        {
          cur = last;
          dir = Vector2.up * sign;
        }
        else if (TryPlaceDayVerticalLocal(ordered, start, count, cur, -sign, virtualDay, totalVirtualDays, out last))
        {
          cur = last;
          dir = Vector2.up * -sign;
        }
        else
        {
          // fallback: too many notes / no space vertically -> regular chain by time
          for (int k = 1; k < count; k++)
          {
            cur = StepChainLocal(cur, ref dir, rng);
            PlaceNoteLocal(ordered[start + k], cur, virtualDay, totalVirtualDays);
          }
        }
      }

      hasPrev = true;
    }
  }

  public void ClearGraph()
  {
    ScapeWarper?.Clear();

    for (int i = 0; i < _nodes.Count; i++)
      if (_nodes[i].t) Destroy(_nodes[i].t.gameObject);

    _nodes.Clear();
    _stars.Clear();
  }

  public void ApplyView(ScapeView view)
  {
    for (int i = 0; i < _nodes.Count; i++)
    {
      var n = _nodes[i];
      if (n.star != null)
        n.star.SetView(view);
    }
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

  private static float RandomRange(System.Random rng, float min, float max)
  {
    return min + (float)rng.NextDouble() * (max - min);
  }

  private static Vector2 Rotate2(Vector2 v, float rad)
  {
    float s = Mathf.Sin(rad);
    float c = Mathf.Cos(rad);
    return new Vector2(v.x * c - v.y * s, v.x * s + v.y * c);
  }

  private float DayStackSign(DateTime day)
  {
    unchecked
    {
      int key = day.Year * 10000 + day.Month * 100 + day.Day;
      return (((key ^ STABLE_SEED) & 1) == 0) ? 1f : -1f;
    }
  }

  private void PlaceNoteLocal(NoteData data, Vector2 localXY, float virtualDay, float totalVirtualDays)
  {
    float zLocal = DepthByVirtualDayLocal(
      virtualDay,
      totalVirtualDays);
    if (clampZToRange)
    {
      float half = dateDepthRange * 0.5f;
      zLocal = Mathf.Clamp(zLocal, -half, +half);
    }

    var localPos = new Vector3(localXY.x, localXY.y, zLocal);
    var worldPos = layoutParent ? layoutParent.TransformPoint(localPos) : localPos;

    var star = starTemplate.Instantiate(worldPos, data, layoutParent);
    _stars.Add(star);

    _nodes.Add(new Node
    {
      star = star,
      t = star.transform,
      radius = 0.60f,
      noteAnchorXY = new Vector2(worldPos.x, worldPos.y)
    });
  }

  private static bool IsMinimumDateSentinel(NoteData note)
  {
    return note != null &&
      note.DateTime == DateTime.MinValue;
  }

  private static float VirtualDayByDate(
    NoteData note,
    DateTime minDate,
    int sentinelExtraVirtualDays,
    int insertedRegularVirtualDaysBefore)
  {
    if (IsMinimumDateSentinel(note))
      return 0f;

    return
      sentinelExtraVirtualDays +
      (float)(note.DateTime - minDate).TotalDays +
      insertedRegularVirtualDaysBefore;
  }

  private float DepthByVirtualDayLocal(
    float virtualDay,
    float totalVirtualDays)
  {
    if (totalVirtualDays <= 0f)
      return 0f;

    float t =
      virtualDay /
      totalVirtualDays;

    float half = dateDepthRange * 0.5f;

    float zFar = +half;
    float zNear = -half;

    if (!olderNotesAreFar)
      (zFar, zNear) = (zNear, zFar);

    return Mathf.Lerp(zFar, zNear, t);
  }

  private bool IsInsideTubeLocal(Vector2 localXY, float margin = 0.02f)
  {
    float r = Mathf.Max(0.001f, boundXYRadius - margin);
    return localXY.sqrMagnitude <= r * r;
  }

  private bool TryPlaceDayVerticalLocal(
    List<NoteData> ordered,
    int start,
    int count,
    Vector2 baseLocal,
    float sign,
    float virtualDay,
    float totalVirtualDays,
    out Vector2 lastLocal)
  {
    lastLocal = baseLocal;

    // Circle is convex: if base & last are inside -> all intermediate points are inside.
    var last = baseLocal + Vector2.up * (sign * sameDateStackDistance * (count - 1));
    if (!IsInsideTubeLocal(last)) return false;

    for (int k = 1; k < count; k++)
    {
      var xy = baseLocal + Vector2.up * (sign * sameDateStackDistance * k);
      PlaceNoteLocal(ordered[start + k], xy, virtualDay, totalVirtualDays);
      lastLocal = xy;
    }

    return true;
  }

  private Vector2 StepChainLocal(Vector2 from, ref Vector2 dir, System.Random rng)
  {
    float turnRad = RandomRange(rng, -chainTurnMaxDeg, chainTurnMaxDeg) * Mathf.Deg2Rad;

    // Try 1: turn
    var nd = Rotate2(dir, turnRad).normalized;
    var cand = from + nd * chainStepDistance;
    if (IsInsideTubeLocal(cand))
    {
      dir = nd;
      return cand;
    }

    // Try 2: opposite turn
    nd = Rotate2(dir, -turnRad).normalized;
    cand = from + nd * chainStepDistance;
    if (IsInsideTubeLocal(cand))
    {
      dir = nd;
      return cand;
    }

    // Last resort: go inward (towards center)
    var inward = -from;
    if (inward.sqrMagnitude < 1e-6f) inward = -dir;
    inward.Normalize();

    dir = inward;
    cand = from + dir * chainStepDistance;

    // If still outside (very rare): clamp to radius once (no transforms)
    if (!IsInsideTubeLocal(cand))
    {
      float r = Mathf.Max(0.001f, boundXYRadius * 0.98f);
      if (cand.sqrMagnitude > 1e-6f) cand = cand.normalized * r;
      else cand = Vector2.right * r;
    }

    return cand;
  }
}
