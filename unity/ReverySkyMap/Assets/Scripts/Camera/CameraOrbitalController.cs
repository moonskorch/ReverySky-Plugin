using UnityEngine;
using UnityEngine.UI;

public class CameraOrbitalController : MonoBehaviour
{
  [Header("Controls")]
  [SerializeField] private Transform startPosition;

  /// <summary>
  /// UI with rotate buttons
  /// </summary>
  [SerializeField] private RotateCameraUI rotateUI;

  [SerializeField] private Slider zoomSlider;

  [SerializeField] private Slider dateSlider;

  [Header("Movement")]
  [SerializeField] private float moveSpeed = 0.01f;
  [SerializeField] private float panLimitToBoundRatio = 1f;

  /// <summary>
  /// Minimum distance to center
  /// </summary>
  [SerializeField] private float zMin = 8f;

  /// <summary>
  /// Maximum distance to center
  /// </summary>
  [SerializeField] private float zMax = 25f;

  [SerializeField] private float followLerp = 7f;

  /// <summary>
  /// Slider units per pixel of pinch
  /// </summary>
  [SerializeField] private float pinchZoomSensitivity = 0.0015f; 
  [SerializeField] private float mouseWheelZoomSensitivity = 0.08f;

  [Header("Orbit")]
  /// <summary>
  /// Rotation speed
  /// </summary>
  [SerializeField] private float rotateLerp = 7f;

  /// <summary>
  /// Degrees per second when rotate button is pressed
  /// </summary>
  [SerializeField] private float rotateSpeedDegrees = 90f;
  [SerializeField] private float mouseRotateSensitivity = 0.15f;

  [SerializeField] private float pivotFollowEps = 0.002f;
  [SerializeField] private float pivotFollowLerp = 12f;
  [SerializeField] private float pivotFollowMaxSpeed = 6f;

  private Vector3 targetPos;
  private Quaternion targetRot;

  // Orbit parameters

  /// <summary>
  /// Y angle around center
  /// </summary>
  private float orbitYaw;

  /// <summary>
  /// Distance to center
  /// </summary>
  private float orbitRadius;

  /// <summary>
  /// Height above center
  /// </summary>
  private float orbitHeight;

  /// <summary>
  /// Additional orbital focus shift (panning)
  /// </summary>
  private Vector3 orbitPanOffset;

  /// <summary>
  /// Orbit radius range (from absolute value zMin/zMax)
  /// </summary>
  private float orbitRadiusMin;
  private float orbitRadiusMax;

  /// <summary>
  /// Continuous rotation state
  /// </summary>
  private bool isRotating;

  /// <summary>
  /// -1f (CCW), +1f (CW), 0f (no rotation)
  /// </summary>
  private float rotateDirection;

  /// <summary>
  /// Active pivot: null => map center (pivotCenter)
  /// </summary>
  private Transform activePivot;
  private Vector3 lastPivotPos;
  private Vector3 pivotCompensation;

  private float dateZMin;
  private float dateZMax;

  private Vector3 ActivePivotPos
  {
    get
    {
      if (activePivot == null)
        return Cartographer.I.Pivot;

      var nav = Cartographer.I.ActiveEngine;
      if (nav != null && nav.TryGetNavigationWorld(activePivot, out var p))
        return p;

      return activePivot.position;
    }
  }

  private void Start()
  {
    targetPos = transform.position;
    targetRot = transform.rotation;

    GameInput.Instance.OnSwipe += HandleSwipe;
    GameInput.Instance.OnPinch += HandlePinch;
    GameInput.Instance.OnMouseWheelZoom += HandleMouseWheelZoom;
    GameInput.Instance.OnMouseRotateDrag += HandleMouseRotateDrag;

    InitOrbitRange();
    SetActivePivot(null);

    if (startPosition != null)
      transform.SetPositionAndRotation(startPosition.position, startPosition.rotation);

    InitOrbitFromCurrentTransform();

    // RotateCameraUI should invoke OnCameraRotated(clockwise, pressed)
    rotateUI.OnCameraRotated += HandleCameraRotated;

    if (zoomSlider != null)
    {
      float relative = Mathf.InverseLerp(orbitRadiusMin, orbitRadiusMax, orbitRadius);
      zoomSlider.SetValueWithoutNotify(relative);
      zoomSlider.onValueChanged.AddListener(HandleZoomChanged);
    }

    if (Cartographer.I.Static25DEngine != null)
      Cartographer.I.Static25DEngine.OnDateAxisRangeChanged += UpdateZAxisRange;

    if (dateSlider != null) 
    {
      Cartographer.I.OnEngineChanged += ShowDateSlider;
      dateSlider.onValueChanged.AddListener(HandleDateChanged);
    }
  }

  private void OnDestroy()
  {
    GameInput.Instance.OnSwipe -= HandleSwipe;
    GameInput.Instance.OnPinch -= HandlePinch;
    GameInput.Instance.OnMouseWheelZoom -= HandleMouseWheelZoom;
    GameInput.Instance.OnMouseRotateDrag -= HandleMouseRotateDrag;

    if (rotateUI != null)
      rotateUI.OnCameraRotated -= HandleCameraRotated;

    if (zoomSlider != null)
      zoomSlider.onValueChanged.RemoveListener(HandleZoomChanged);

    if (Cartographer.I.Static25DEngine != null)
      Cartographer.I.Static25DEngine.OnDateAxisRangeChanged -= UpdateZAxisRange;

    if (dateSlider != null) 
    {
      dateSlider.onValueChanged.RemoveListener(HandleDateChanged);
      Cartographer.I.OnEngineChanged -= ShowDateSlider;
    }
  }

  private void Update()
  {
    // 1. Smoothly compensate pivot movement (warp/rebuild/etc)
    if (activePivot != null)
    {
      var pivotPos = ActivePivotPos;
      var dp = pivotPos - lastPivotPos;

      var pivotMoved = false;
      if (dp.sqrMagnitude > pivotFollowEps * pivotFollowEps)
      {
        lastPivotPos = pivotPos;
        pivotCompensation += dp;
        pivotMoved = true;
      }

      float k = 1f - Mathf.Exp(-pivotFollowLerp * Time.deltaTime);
      var step = Vector3.Lerp(Vector3.zero, pivotCompensation, k);

      float maxStep = pivotFollowMaxSpeed * Time.deltaTime;
      if (step.sqrMagnitude > maxStep * maxStep)
        step = step.normalized * maxStep;

      targetPos += step;
      pivotCompensation -= step;

      var focus = ActivePivotPos + orbitPanOffset;
      targetRot = Quaternion.LookRotation(focus - targetPos, Vector3.up);

      if (pivotMoved)
        SyncDateSliderFromCurrentFocus();
    }

    // 2. Continuous orbit rotation while button is pressed
    if (isRotating && Mathf.Abs(rotateDirection) > 0.001f)
    {
      float delta = rotateSpeedDegrees * rotateDirection * Time.deltaTime;

      if (!Mathf.Approximately(delta, 0f))
      {
        float prevYaw = orbitYaw;
        orbitYaw += delta;

        if (!Mathf.Approximately(prevYaw, orbitYaw))
        {
          RebuildOrbitTarget();
        }
      }
    }

    // 3. Smooth follow camera to target position / rotation
    transform.position = Vector3.Lerp(
      transform.position, targetPos, Time.deltaTime * followLerp);

    transform.rotation = Quaternion.Slerp(
      transform.rotation, targetRot, Time.deltaTime * rotateLerp);
  }

  private void SyncOrbitFromTarget()
  {
    Vector3 center = ActivePivotPos + orbitPanOffset;
    Vector3 offset = targetPos - center;

    orbitHeight = offset.y;

    Vector2 flat = new Vector2(offset.x, offset.z);
    orbitRadius = flat.magnitude;

    if (orbitRadius < 0.001f)
    {
      orbitRadius = Mathf.Max(orbitRadiusMin, 0.01f);
      orbitYaw = 0f;
    }
    else
    {
      // Angle around Y: (x,z) → (orbitYaw)
      orbitYaw = Mathf.Atan2(flat.x, flat.y) * Mathf.Rad2Deg;
    }

    // Camera looks toward the center
    targetRot = Quaternion.LookRotation(center - targetPos, Vector3.up);
  }

  private void InitOrbitRange()
  {
    float a = Mathf.Abs(zMin);
    float b = Mathf.Abs(zMax);

    if (Mathf.Approximately(a, b))
    {
      // Set default in case they are the same
      orbitRadiusMin = 5f;
      orbitRadiusMax = 20f;
    }
    else
    {
      orbitRadiusMin = Mathf.Min(a, b);
      orbitRadiusMax = Mathf.Max(a, b);
    }
  }

  private void InitOrbitFromCurrentTransform()
  {
    orbitPanOffset = Vector3.zero;

    // Take the current camera position as targetPos
    targetPos = transform.position;

    // Calculate orbitYaw / orbitRadius / orbitHeight and target rotation
    SyncOrbitFromTarget();

    // Start from the correct state
    transform.position = targetPos;
    transform.rotation = targetRot;

    // Continuous rotation initial state
    isRotating = false;
    rotateDirection = 0f;

    lastPivotPos = ActivePivotPos;
  }

  private void RebuildOrbitTarget()
  {
    // Current orbital focus with panning
    Vector3 focus = ActivePivotPos + orbitPanOffset;

    // Base vector from focus + height / radius
    Vector3 offset = new Vector3(0f, orbitHeight, orbitRadius);

    // Rotation around Y axis by orbitYaw
    Quaternion yawRot = Quaternion.Euler(0f, orbitYaw, 0f);
    offset = yawRot * offset;

    // Camera position toward focus point
    targetPos = focus + offset;
    targetRot = Quaternion.LookRotation(focus - targetPos, Vector3.up);
  }

  private void HandleZoomChanged(float value)
  {
    // Zoom is distance change from center to the camera
    orbitRadius = Mathf.Lerp(orbitRadiusMin, orbitRadiusMax, value);
    RebuildOrbitTarget();
  }

  private void HandleSwipe(Vector2 delta, Vector2 pos)
  {
    // Orbital focus shift in the plane perpendicular to the camera's view
    Vector3 move = Vector3.zero;

    // Swipe left/right → panning by the right axis
    move += -delta.x * moveSpeed * transform.right;

    // Swipe up/down → panning by the up axis
    move += -delta.y * moveSpeed * transform.up;

    // Apply shift to orbital focus
    orbitPanOffset += move;

    // TODO Swiping after reaching limits results in small angular movement
    float half = Cartographer.I.BoundRadius * panLimitToBoundRatio;

    Vector3 center = Cartographer.I.Pivot;
    Vector3 focus = ActivePivotPos + orbitPanOffset;

    focus.x = Mathf.Clamp(focus.x, center.x - half, center.x + half);
    focus.y = Mathf.Clamp(focus.y, center.y - half, center.y + half);

    orbitPanOffset.x = focus.x - ActivePivotPos.x;
    orbitPanOffset.y = focus.y - ActivePivotPos.y;

    SyncDateSliderFromCurrentFocus();
    // Recalculate camera's position and rotation by orbital parameters
    RebuildOrbitTarget();
  }

  private void HandlePinch(float pinchDelta)
  {
    // pinchDelta > 0 when fingers move apart
    // We want pinch-out => zoom IN (closer) => smaller orbitRadius => smaller slider value
    if (zoomSlider != null)
    {
      float next = Mathf.Clamp01(zoomSlider.value - pinchDelta * pinchZoomSensitivity);
      zoomSlider.SetValueWithoutNotify(next);
      HandleZoomChanged(next); 
    }
    else
    {
      float t = Mathf.InverseLerp(orbitRadiusMin, orbitRadiusMax, orbitRadius);
      t = Mathf.Clamp01(t - pinchDelta * pinchZoomSensitivity);
      orbitRadius = Mathf.Lerp(orbitRadiusMin, orbitRadiusMax, t);
      RebuildOrbitTarget();
    }
  }

  public void SetActivePivot(Transform pivot, bool resetPanOffset = true)
  {
    activePivot = pivot;

    if (resetPanOffset)
      orbitPanOffset = Vector3.zero;

    lastPivotPos = ActivePivotPos;
    pivotCompensation = Vector3.zero;
  }

  private void HandleMouseWheelZoom(float wheelDelta)
  {
    if (Mathf.Approximately(wheelDelta, 0f))
      return;

    if (zoomSlider != null)
    {
      float next = Mathf.Clamp01(zoomSlider.value - wheelDelta * mouseWheelZoomSensitivity);
      zoomSlider.SetValueWithoutNotify(next);
      HandleZoomChanged(next);
      return;
    }

    float t = Mathf.InverseLerp(orbitRadiusMin, orbitRadiusMax, orbitRadius);
    t = Mathf.Clamp01(t - wheelDelta * mouseWheelZoomSensitivity);
    orbitRadius = Mathf.Lerp(orbitRadiusMin, orbitRadiusMax, t);
    RebuildOrbitTarget();
  }

  private void HandleMouseRotateDrag(float deltaX)
  {
    if (Mathf.Abs(deltaX) < 0.001f)
      return;

    orbitYaw += deltaX * mouseRotateSensitivity;
    RebuildOrbitTarget();
  }

  public void Focus(Vector3 targetPos, float selectedDistance)
  {
    Vector3 center = ActivePivotPos;
    Vector3 dir = (targetPos - center);

    Vector3 cameraPosition;

    if (dir.sqrMagnitude < 0.0001f)
    {
      // if pivot is equal to target (if focus node),
      // set camera from the side it was already planned to be
      Vector3 fromTargetToCam = (this.targetPos - targetPos);
      if (fromTargetToCam.sqrMagnitude < 0.0001f)
        fromTargetToCam = (transform.position - targetPos);
      if (fromTargetToCam.sqrMagnitude < 0.0001f)
        fromTargetToCam = -transform.forward;

      fromTargetToCam.Normalize();
      cameraPosition = targetPos + fromTargetToCam * selectedDistance;
    }
    else
    {
      dir.Normalize();
      cameraPosition = targetPos + dir * selectedDistance;
    }

    orbitPanOffset = Vector3.zero;
    Move(cameraPosition);
  }

  private void Move(Vector3 worldPos)
  {
    // Set new target position
    targetPos = worldPos;

    // Calculate orbit parameters and target rotation
    SyncOrbitFromTarget();

    // Update zoom slider to the new distance to the center
    if (zoomSlider != null)
    {
      float relative = Mathf.InverseLerp(orbitRadiusMin, orbitRadiusMax, orbitRadius);
      zoomSlider.SetValueWithoutNotify(relative);
    }

    SyncDateSliderFromCurrentFocus();
  }

  private void HandleCameraRotated(bool clockwise, bool pressed)
  {
    if (pressed)
    {
      // Snap to target before starting rotation to avoid mid-lerp artifacts
      transform.position = targetPos;
      transform.rotation = targetRot;

      isRotating = true;
      rotateDirection = clockwise ? 1f : -1f;
    }
    else
    {
      isRotating = false;
      rotateDirection = 0f;
    }
  }

  public void ResetToStart(bool snap = true)
  {
    SetActivePivot(null);

    isRotating = false;
    rotateDirection = 0f;

    if (startPosition != null)
      targetPos = startPosition.position;

    SyncOrbitFromTarget();

    if (snap)
    {
      transform.position = targetPos;
      transform.rotation = targetRot;
    }

    if (zoomSlider != null)
    {
      float relative = Mathf.InverseLerp(orbitRadiusMin, orbitRadiusMax, orbitRadius);
      zoomSlider.SetValueWithoutNotify(relative);
    }

    lastPivotPos = ActivePivotPos;
    pivotCompensation = Vector3.zero;

    SyncDateSliderFromCurrentFocus();
  }

  // TODO
  // Reset selected in focusNode
  // 2 sliders are too much, change control design for 2.5D engine - probable move zoom to gesture
  private void HandleDateChanged(float value)
  {
    if (dateSlider == null || !dateSlider.gameObject.activeInHierarchy) return;

    if (activePivot != null)
    {
      // Save current world focus point (node)
      Vector3 focusWorld = ActivePivotPos + orbitPanOffset;

      // Reset pivot to сenter without changing panOffset
      SetActivePivot(null, resetPanOffset: false);

      // Compensate offset so that focus in world won't move
      orbitPanOffset = focusWorld - ActivePivotPos;
    }

    orbitPanOffset.z = Mathf.Lerp(dateZMin, dateZMax, value);
    RebuildOrbitTarget();
  }

  private void ShowDateSlider(MapLayoutMode engine)
  {
    if (dateSlider == null) return;
    dateSlider.gameObject.SetActive(engine == MapLayoutMode.Dates);

    SyncDateSliderFromCurrentFocus();
  }

  private void UpdateZAxisRange(float zMin, float zMax)
  {
    if (dateSlider == null) return;

    dateZMin = zMin;
    dateZMax = zMax;

    // Do not call focus during node selection, do it only when pivot = null
    if (activePivot == null)
      orbitPanOffset.z = Mathf.Clamp(orbitPanOffset.z, dateZMin, dateZMax);

    SyncDateSliderFromCurrentFocus();
  }

  public void UpdateDateSlider()
  {
    if (dateSlider == null) return;

    if (Cartographer.I.Static25DEngine != null && 
      Cartographer.I.ActiveEngine?.EngineType == MapLayoutMode.Dates)
    {
      UpdateZAxisRange(Cartographer.I.Static25DEngine.ZMin, Cartographer.I.Static25DEngine.ZMax);
    }

    ShowDateSlider(Cartographer.I.ActiveEngine?.EngineType ?? MapLayoutMode.Auto);
  }

  private void SyncDateSliderFromCurrentFocus()
  {
    if (dateSlider == null) return;
    if (Cartographer.I?.ActiveEngine?.EngineType != MapLayoutMode.Dates) return;

    // range might be not initialized yet
    if (Mathf.Approximately(dateZMin, dateZMax)) return;

    // Focus Z in world
    float focusZ = (ActivePivotPos + orbitPanOffset).z;

    // Convert to "date axis" offset relative to map center
    float centerZ = Cartographer.I.Pivot.z;
    float zOffset = focusZ - centerZ;

    // Clamp only for slider representation (do not change camera state)
    zOffset = Mathf.Clamp(zOffset, dateZMin, dateZMax);

    float rel = Mathf.InverseLerp(dateZMin, dateZMax, zOffset);
    dateSlider.SetValueWithoutNotify(rel);
  }
}
