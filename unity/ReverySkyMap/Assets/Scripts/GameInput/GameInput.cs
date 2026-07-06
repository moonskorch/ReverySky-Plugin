using System;
using UnityEngine;
using UnityEngine.EventSystems;

// TODO Input Manager is marked for deprecation. Use the Input System package instead.
public class GameInput : MonoBehaviour
{
  public static GameInput Instance { get; private set; }

  [SerializeField] private LayerMask interactableLayers;

  [Header("Gesture thresholds")]
  [SerializeField] private float selectMaxDuration = 0.25f;

  [SerializeField] private float panDeadZonePx = 12f;

  public LayerMask InteractableLayers => interactableLayers;

  // Raw interaction events
  public event Action<Vector2> OnPressBegan;
  public event Action<Vector2> OnPressMoved;
  public event Action<Vector2> OnPressEnded;

  // Semantic events
  public event Action<Vector2> OnSelect;
  public event Action OnPanStart;
  public event Action OnPanEnd;
  public event Action<Vector2, Vector2> OnPan; // (delta, currentPosition)
  public event Action<float> OnPinchZoom;
  public event Action<float> OnScrollZoom;
  public event Action<float> OnOrbitDrag;

  private Vector2 lastPressPos;
  private Vector2 startPos;
  private float startTime;
  private float accumMovement;
  private bool panning;
  private bool pinchInProgress;

  private int? blockedFingerId = null;
  private bool blockedMouse = false;
  private bool blockedRightMouse = false;
  private bool rightDragging = false;
  private Vector2 lastRightMousePos;

  private void Awake()
  {
    if (Instance != null) 
      Debug.LogError("More than one instance of GameInput");
    Instance = this;
  }

  private void Update()
  {
    if (Input.touchCount == 0)
    {
      HandleMouseInput();
      return;
    }

    if (Input.touchCount == 2)
    {
      Touch t0 = Input.GetTouch(0);
      Touch t1 = Input.GetTouch(1);

      if (IsOverUI(t0) || IsOverUI(t1)) return;

      if (blockedFingerId.HasValue &&
          (t0.fingerId == blockedFingerId.Value || t1.fingerId == blockedFingerId.Value))
        return;

      pinchInProgress = true;

      Vector2 p0Prev = t0.position - t0.deltaPosition;
      Vector2 p1Prev = t1.position - t1.deltaPosition;
      float prevDist = (p0Prev - p1Prev).magnitude;
      float currDist = (t0.position - t1.position).magnitude;

      OnPinchZoom?.Invoke(currDist - prevDist);
      return;
    }

    if (Input.touchCount == 1)
    {
      Touch touch = Input.GetTouch(0);

      // Ignore interaction if it started under UI.
      if (blockedFingerId.HasValue && touch.fingerId == blockedFingerId.Value)
      {
        if (touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled)
          blockedFingerId = null;
        return;
      }

      switch (touch.phase)
      {
        case TouchPhase.Began:
          pinchInProgress = false;
          if (IsOverUI(touch))
          {
            blockedFingerId = touch.fingerId;
            return;
          }

          blockedFingerId = null;
          panning = false;
          accumMovement = 0f;
          startPos = lastPressPos = touch.position;
          startTime = Time.unscaledTime;

          OnPressBegan?.Invoke(touch.position);
          break;

        case TouchPhase.Moved:
          if (blockedFingerId.HasValue) break;

          Vector2 delta = touch.position - lastPressPos;
          lastPressPos = touch.position;

          OnPressMoved?.Invoke(delta);

          if (!panning)
          {
            accumMovement += delta.magnitude;

            if (accumMovement >= panDeadZonePx)
            {
              panning = true;
              OnPanStart?.Invoke();

              float overshoot = accumMovement - panDeadZonePx;
              if (overshoot > 0f)
              {
                Vector2 effective = delta.normalized * overshoot;
                OnPan?.Invoke(effective, touch.position);
              }
            }
          }
          else
          {
            OnPan?.Invoke(delta, touch.position);
          }
          break;

        case TouchPhase.Ended:
        case TouchPhase.Canceled:
          if (blockedFingerId.HasValue) { blockedFingerId = null; break; }

          if (panning)
          {
            OnPanEnd?.Invoke();
          }
          else if (!pinchInProgress)
          {
            float duration = Time.unscaledTime - startTime;
            float moved = (touch.position - startPos).magnitude;
            if (duration <= selectMaxDuration && moved <= panDeadZonePx)
              OnSelect?.Invoke(touch.position);
            else
              OnPressEnded?.Invoke(touch.position);
          }

          panning = false;
          pinchInProgress = false;
          accumMovement = 0f;
          break;
      }
    }
  }

  private void HandleMouseInput()
  {
    var mousePos = (Vector2)Input.mousePosition;

    float scrollDelta = Input.mouseScrollDelta.y;
    if (Mathf.Abs(scrollDelta) > Mathf.Epsilon && !IsMouseOverUI())
      OnScrollZoom?.Invoke(scrollDelta);

    if (Input.GetMouseButtonDown(1))
    {
      if (IsMouseOverUI())
      {
        blockedRightMouse = true;
      }
      else
      {
        blockedRightMouse = false;
        rightDragging = true;
        lastRightMousePos = mousePos;
      }
    }

    if (blockedRightMouse)
    {
      if (Input.GetMouseButtonUp(1))
        blockedRightMouse = false;
    }
    else if (rightDragging && Input.GetMouseButton(1))
    {
      Vector2 rightDelta = mousePos - lastRightMousePos;
      if (rightDelta.sqrMagnitude > 0f)
      {
        lastRightMousePos = mousePos;
        OnOrbitDrag?.Invoke(rightDelta.x);
      }
    }

    if (Input.GetMouseButtonUp(1))
      rightDragging = false;

    if (Input.GetMouseButtonDown(0))
    {
      pinchInProgress = false;
      if (IsMouseOverUI())
      {
        blockedMouse = true;
        return;
      }

      blockedMouse = false;
      panning = false;
      accumMovement = 0f;
      startPos = lastPressPos = mousePos;
      startTime = Time.unscaledTime;
      OnPressBegan?.Invoke(mousePos);
      return;
    }

    if (blockedMouse)
    {
      if (Input.GetMouseButtonUp(0))
        blockedMouse = false;
      return;
    }

    if (Input.GetMouseButton(0))
    {
      Vector2 delta = mousePos - lastPressPos;
      if (delta.sqrMagnitude <= 0f)
        return;

      lastPressPos = mousePos;
      OnPressMoved?.Invoke(delta);

      if (!panning)
      {
        accumMovement += delta.magnitude;
        if (accumMovement >= panDeadZonePx)
        {
          panning = true;
          OnPanStart?.Invoke();

          float overshoot = accumMovement - panDeadZonePx;
          if (overshoot > 0f)
          {
            Vector2 effective = delta.normalized * overshoot;
            OnPan?.Invoke(effective, mousePos);
          }
        }
      }
      else
      {
        OnPan?.Invoke(delta, mousePos);
      }

      return;
    }

    if (Input.GetMouseButtonUp(0))
    {
      if (panning)
      {
        OnPanEnd?.Invoke();
      }
      else if (!pinchInProgress)
      {
        float duration = Time.unscaledTime - startTime;
        float moved = (mousePos - startPos).magnitude;
        if (duration <= selectMaxDuration && moved <= panDeadZonePx)
          OnSelect?.Invoke(mousePos);
        else
          OnPressEnded?.Invoke(mousePos);
      }

      panning = false;
      pinchInProgress = false;
      accumMovement = 0f;
    }
  }

  private bool IsOverUI(Touch touch)
  {
    return EventSystem.current != null &&
           EventSystem.current.IsPointerOverGameObject(touch.fingerId);
  }

  private bool IsMouseOverUI()
  {
    return EventSystem.current != null &&
           EventSystem.current.IsPointerOverGameObject();
  }
}
