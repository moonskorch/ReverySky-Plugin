using System;
using UnityEngine;
using UnityEngine.UI;

public class RotateCameraUI : MonoBehaviour
{
  [SerializeField] private Button rotateLeftButton;
  [SerializeField] private Button rotateRightButton;

  // Event triggered for the camera rotation,
  // with arguments: clockwise / counterclockwise, pressed
  public Action<bool, bool> OnCameraRotated;

  public void SetRotationPressed(bool clockwise, bool pressed)
  {
    OnCameraRotated?.Invoke(clockwise, pressed);
  }
}
