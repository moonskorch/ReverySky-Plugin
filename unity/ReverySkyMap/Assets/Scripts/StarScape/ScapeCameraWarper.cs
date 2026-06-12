using System.Collections.Generic;
using UnityEngine;

public sealed class ScapeCameraWarper : MonoBehaviour
{
  [Header("Refs")]
  [SerializeField] private Camera cam;
  [SerializeField] private Transform layoutParent;

  [Header("Warp shape")]
  [Tooltip("From what depth (along the sausage axis) do we begin expanding the pipe")]
  [SerializeField] private float depthStart = 6f;

  [Tooltip("At what depth (along the sausage axis) does the expansion reach maxScale")]
  [SerializeField] private float depthEnd = 60f;

  [Tooltip("Maximum pipe radius multiplier")]
  [SerializeField] private float maxScale = 6f;

  [Tooltip("Curve steepness (1..3 is usually good)")]
  [SerializeField] private float power = 1.6f;

  [Header("Engine Profiles")]
  [SerializeField] private bool useEngineProfiles = true;
  [SerializeField] private float forcesDepthStart = 6f;
  [SerializeField] private float forcesDepthEnd = 180f;
  [SerializeField] private float forcesMaxScale = 12f;
  [SerializeField] private float staticDepthStart = 0f;
  [SerializeField] private float staticDepthEnd = 1000f;
  [SerializeField] private float staticMaxScale = 60f;

  [Header("Performance")]
  [SerializeField] private float posEps = 0.002f;
  [SerializeField] private float rotEpsDeg = 0.08f;
  [SerializeField] private float fovEps = 0.05f;

  [Tooltip("0 = every frame while moving. Otherwise, for example, 20 for low-end devices")]
  [SerializeField] private float maxHzWhileMoving = 0f;

  private Transform[] _trs;
  private Vector3[] _baseLocal;
  private readonly Dictionary<Transform, int> _indexByTr = new();
  private int _count;

  private Vector3 _lastCamPos;
  private Quaternion _lastCamRot;
  private float _lastFov;

  private bool _dirty = true;

  private float _nextAllowedTime = 0f;

  private Vector3 _tubeAxisWorld = Vector3.forward;
  private Vector3 _tubeOriginWorld = Vector3.zero;

  public void ApplyEngineProfile(MapLayoutMode engineType)
  {
    if (!useEngineProfiles)
      return;

    float nextDepthStart;
    float nextDepthEnd;
    float nextMaxScale;

    if (engineType == MapLayoutMode.Dates)
    {
      nextDepthStart = staticDepthStart;
      nextDepthEnd = staticDepthEnd;
      nextMaxScale = staticMaxScale;
    }
    else
    {
      nextDepthStart = forcesDepthStart;
      nextDepthEnd = forcesDepthEnd;
      nextMaxScale = forcesMaxScale;
    }

    if (Mathf.Approximately(depthStart, nextDepthStart) &&
        Mathf.Approximately(depthEnd, nextDepthEnd) &&
        Mathf.Approximately(maxScale, nextMaxScale))
    {
      return;
    }

    depthStart = nextDepthStart;
    depthEnd = nextDepthEnd;
    maxScale = nextMaxScale;
    _dirty = true;
  }

  /// <summary>
  /// Rebind to the currend map
  /// </summary>
  public void Rebind(ICartographerEngine engine)
  {
    if (!cam) cam = Camera.main;

    if (engine == null || engine.Stars == null || engine.Stars.Count == 0)
    {
      Clear();
      return;
    }

    var stars = engine.Stars;
    _count = stars.Count;

    _indexByTr.Clear();
    _trs = new Transform[_count];
    _baseLocal = new Vector3[_count];

    for (int i = 0; i < _count; i++)
    {
      var s = stars[i];
      var tr = (s != null) ? s.transform : null;
      _trs[i] = tr;
      if (tr) _indexByTr[tr] = i;

      if (!tr)
      {
        _baseLocal[i] = Vector3.zero;
        continue;
      }

      // Save base position (in local layoutParent), so that warp will always be stable
      _baseLocal[i] = layoutParent
        ? layoutParent.InverseTransformPoint(tr.position)
        : tr.position;
    }

    ComputeTubeAxisAndOrigin();

    _dirty = true;
    SnapshotCamera();

    // Apply it immediately so that the scattering already occurs during the first rendering
    ApplyWarp();
    _dirty = false;
  }

  public void Clear()
  {
    _trs = null;
    _baseLocal = null;
    _indexByTr.Clear();
    _count = 0;
    _dirty = true;
  }

  private void LateUpdate()
  {
    if (_count <= 0 || _trs == null || !cam) return;

    if (maxHzWhileMoving > 0f && Time.unscaledTime < _nextAllowedTime)
      return;

    if (!_dirty && !CameraChangedEnough())
      return;

    ApplyWarp();
    _dirty = false;

    if (maxHzWhileMoving > 0f)
      _nextAllowedTime = Time.unscaledTime + (1f / maxHzWhileMoving);
  }

  private void ApplyWarp()
  {
    var ct = cam.transform;
    float forwardDot = Vector3.Dot(ct.forward, _tubeAxisWorld);
    float hemisphereSign = (forwardDot >= 0f) ? 1f : -1f;

    float minDepth = float.PositiveInfinity;
    float maxDepth = float.NegativeInfinity;

    for (int i = 0; i < _count; i++)
    {
      var tr = _trs[i];
      if (!tr) continue;

      // base world-position from saved original layout
      Vector3 baseWorld = layoutParent
        ? layoutParent.TransformPoint(_baseLocal[i])
        : _baseLocal[i];

      // Depth forwards on the tube - to the side where camera is looking along the axis
      float depth = hemisphereSign * Vector3.Dot(baseWorld - ct.position, _tubeAxisWorld);

      minDepth = Mathf.Min(minDepth, depth);
      maxDepth = Mathf.Max(maxDepth, depth);

      // Don't change behind the camera along the axis
      if (depth <= 0.001f)
      {
        tr.position = baseWorld;
        continue;
      }

      // t -> scale
      float t = Mathf.InverseLerp(depthStart, depthEnd, depth);
      t = t * t * (3f - 2f * t); // smoothstep
      float s = 1f + (maxScale - 1f) * Mathf.Pow(t, power);

      // Enlargy by radius around axis:
      // 1) find closes point on the asix
      // 2) multiply radial vecor by s 
      Vector3 rel = baseWorld - _tubeOriginWorld;
      float along = Vector3.Dot(rel, _tubeAxisWorld);
      Vector3 onAxis = _tubeOriginWorld + _tubeAxisWorld * along;
      Vector3 radial = baseWorld - onAxis;

      tr.position = onAxis + radial * s;
    }

    SnapshotCamera();
  }

  private void ComputeTubeAxisAndOrigin()
  {
    _tubeOriginWorld = layoutParent ? layoutParent.position : Vector3.zero;

    // fixed axis: map Z
    _tubeAxisWorld = layoutParent ? layoutParent.forward : Vector3.forward;
    _tubeAxisWorld.Normalize();
  }

  private bool CameraChangedEnough()
  {
    var ct = cam.transform;

    if ((ct.position - _lastCamPos).sqrMagnitude > (posEps * posEps))
      return true;

    if (Quaternion.Angle(ct.rotation, _lastCamRot) > rotEpsDeg)
      return true;

    if (Mathf.Abs(cam.fieldOfView - _lastFov) > fovEps)
      return true;

    return false;
  }

  private void SnapshotCamera()
  {
    var ct = cam.transform;
    _lastCamPos = ct.position;
    _lastCamRot = ct.rotation;
    _lastFov = cam.fieldOfView;
  }

  public void ApplyBaseNow()
  {
    if (_count <= 0 || _trs == null) return;

    for (int i = 0; i < _count; i++)
    {
      var tr = _trs[i];
      if (!tr) continue;

      Vector3 baseWorld = layoutParent
        ? layoutParent.TransformPoint(_baseLocal[i])
        : _baseLocal[i];

      tr.position = baseWorld;
    }

    // Next LateUpdate will recalculate warp if needed
    _dirty = true;
  }

  public void ApplyWarpNow()
  {
    if (_count <= 0 || _trs == null || !cam) return;
    ApplyWarp();
    _dirty = false;
  }

  public bool TryGetBaseWorld(Transform tr, out Vector3 baseWorld)
  {
    baseWorld = default;
    if (!tr || _trs == null) return false;

    if (!_indexByTr.TryGetValue(tr, out int i)) return false;

    baseWorld = layoutParent
      ? layoutParent.TransformPoint(_baseLocal[i])
      : _baseLocal[i];

    return true;
  }
}
