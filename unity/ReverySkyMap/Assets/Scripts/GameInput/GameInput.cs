using System;
using UnityEngine;
using UnityEngine.EventSystems;

// TODO Input Manager is marked for deprecation. Use the Input System package instead.
public class GameInput : MonoBehaviour
{
  public static GameInput Instance { get; private set; }

  [SerializeField] private LayerMask interactableLayers;

  [Header("Gesture thresholds")]
  [SerializeField] private float tapMaxDuration = 0.25f;   // seconds
  [SerializeField] private float swipeDeadZonePx = 12f;    // pixels

  public LayerMask InteractableLayers => interactableLayers;

  // Raw events
  public event Action<Vector2> OnTouchBegan;
  public event Action<Vector2> OnTouchMoved;
  public event Action<Vector2> OnTouchEnded;

  // Semantic events
  public event Action<Vector2> OnTap;
  public event Action OnDragStart;
  public event Action OnDragEnd;
  public event Action<Vector2, Vector2> OnSwipe; // (delta, currentPosition)
  public event Action<float> OnPinch;
  public event Action<float> OnMouseWheelZoom;
  public event Action<float> OnMouseRotateDrag;

  private Vector2 lastTouchPos;
  private Vector2 startPos;
  private float startTime;
  private float accumMovement;     // sum |delta| from touch start
  private bool dragging;           // is over swipe threshold  
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
    // DESKTOP MOUSE
    if (Input.touchCount == 0)
    {
      HandleMouseInput();
      return;
    }

    // PINCH
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

      OnPinch?.Invoke(currDist - prevDist);
      return;
    }

    // SINGLE TOUCH
    if (Input.touchCount == 1)
    {
      Touch touch = Input.GetTouch(0);

      // Ignore tock if it started under UI
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
          dragging = false;
          accumMovement = 0f;
          startPos = lastTouchPos = touch.position;
          startTime = Time.unscaledTime;

          OnTouchBegan?.Invoke(touch.position);
          break;

        case TouchPhase.Moved:
          if (blockedFingerId.HasValue) break;

          Vector2 delta = touch.position - lastTouchPos;
          lastTouchPos = touch.position;

          OnTouchMoved?.Invoke(delta);

          if (!dragging)
          {
            // Accumulate sum movement
            float prevAccum = accumMovement;
            accumMovement += delta.magnitude;

            if (accumMovement >= swipeDeadZonePx)
            {
              // Enter drag: invoke OnDragStart and first delta -
              // surplus over the threshold toward the current sum
              dragging = true;
              OnDragStart?.Invoke();

              float overshoot = accumMovement - swipeDeadZonePx;
              if (overshoot > 0f)
              {
                // Direction - to the currend delta vector (suffucient for UX)
                Vector2 effective = delta.normalized * overshoot;
                OnSwipe?.Invoke(effective, touch.position);
              }
            }
            // Otherwise do nothing until threshold is reached 
          }
          else
          {
            // Already during dragging - send delta as it is
            OnSwipe?.Invoke(delta, touch.position);
          }
          break;

        case TouchPhase.Ended:
        case TouchPhase.Canceled:
          if (blockedFingerId.HasValue) { blockedFingerId = null; break; }

          if (dragging)
          {
            OnDragEnd?.Invoke();
            // Do not interprete as Tap
          }
          else if (!pinchInProgress)
          {
            float duration = Time.unscaledTime - startTime;
            float moved = (touch.position - startPos).magnitude;
            if (duration <= tapMaxDuration && moved <= swipeDeadZonePx)
              OnTap?.Invoke(touch.position);
            else
              OnTouchEnded?.Invoke(touch.position); 
          }

          dragging = false;
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
      OnMouseWheelZoom?.Invoke(scrollDelta);

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
        OnMouseRotateDrag?.Invoke(rightDelta.x);
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
      dragging = false;
      accumMovement = 0f;
      startPos = lastTouchPos = mousePos;
      startTime = Time.unscaledTime;
      OnTouchBegan?.Invoke(mousePos);
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
      Vector2 delta = mousePos - lastTouchPos;
      if (delta.sqrMagnitude <= 0f)
        return;

      lastTouchPos = mousePos;
      OnTouchMoved?.Invoke(delta);

      if (!dragging)
      {
        accumMovement += delta.magnitude;
        if (accumMovement >= swipeDeadZonePx)
        {
          dragging = true;
          OnDragStart?.Invoke();

          float overshoot = accumMovement - swipeDeadZonePx;
          if (overshoot > 0f)
          {
            Vector2 effective = delta.normalized * overshoot;
            OnSwipe?.Invoke(effective, mousePos);
          }
        }
      }
      else
      {
        OnSwipe?.Invoke(delta, mousePos);
      }

      return;
    }

    if (Input.GetMouseButtonUp(0))
    {
      if (dragging)
      {
        OnDragEnd?.Invoke();
      }
      else if (!pinchInProgress)
      {
        float duration = Time.unscaledTime - startTime;
        float moved = (mousePos - startPos).magnitude;
        if (duration <= tapMaxDuration && moved <= swipeDeadZonePx)
          OnTap?.Invoke(mousePos);
        else
          OnTouchEnded?.Invoke(mousePos);
      }

      dragging = false;
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
