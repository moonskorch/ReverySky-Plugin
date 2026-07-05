using UnityEngine;
using UnityEngine.EventSystems;

[DisallowMultipleComponent]
public sealed class RotateHoldButton : MonoBehaviour, IPointerDownHandler, IPointerUpHandler, IPointerExitHandler
{
  [SerializeField] private RotateCameraUI rotateUI;
  [SerializeField] private Direction direction = Direction.Left;

  private bool pressed;

  private enum Direction
  {
    Left,
    Right
  }

  public void OnPointerDown(PointerEventData eventData)
  {
    pressed = true;
    SetRotationPressed(true);
  }

  public void OnPointerUp(PointerEventData eventData)
  {
    StopRotation();
  }

  public void OnPointerExit(PointerEventData eventData)
  {
    StopRotation();
  }

  private void OnDisable()
  {
    StopRotation();
  }

  private void StopRotation()
  {
    if (!pressed)
      return;

    pressed = false;
    SetRotationPressed(false);
  }

  private void SetRotationPressed(bool isPressed)
  {
    rotateUI.SetRotationPressed(direction == Direction.Right, isPressed);
  }
}
