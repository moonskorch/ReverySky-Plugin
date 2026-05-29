using System;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;

public class RotateCameraUI : MonoBehaviour
{
  [SerializeField] private Button rotateLeftButton;
  [SerializeField] private Button rotateRightButton;

  // Event triggered for the camera rotation,
  // with arguments: clockwise / counterclockwise, pressed
  public Action<bool, bool> OnCameraRotated;

  public void StartRotateLeft(BaseEventData eventData)
  {
    OnCameraRotated?.Invoke(false, true);
  }

  public void StopRotateLeft(BaseEventData eventData)
  {
    OnCameraRotated?.Invoke(false, false);
  }

  public void StartRotateRight(BaseEventData eventData)
  {
    OnCameraRotated?.Invoke(true, true);
  }

  public void StopRotateRight(BaseEventData eventData)
  {
    OnCameraRotated?.Invoke(true, false);
  }
}
