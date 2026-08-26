using UnityEngine;

/// <summary>
/// Faces the camera while enabled.
/// </summary>
/// <remarks>
/// Keep it disabled by default and toggle it from the owning object.
/// OnEnable aligns immediately, OnDisable unregisters.
/// </remarks>
public sealed class LookAtCamera : MonoBehaviour
{
  [SerializeField] private LookAtCameraMode mode = LookAtCameraMode.OnCameraChanged;

  private void OnEnable()
  {
    if (mode == LookAtCameraMode.OnCameraChanged)
      CameraForwardWatcher.I.Register(this);
    else if (mode == LookAtCameraMode.EveryFrame)
      ApplyCameraForward(CameraForwardWatcher.I.CurrentForward);
  }

  private void OnDisable()
  {
    if (mode == LookAtCameraMode.OnCameraChanged)
      CameraForwardWatcher.I.Unregister(this);
  }

  private void LateUpdate()
  {
    if (mode == LookAtCameraMode.EveryFrame)
      ApplyCameraForward(CameraForwardWatcher.I.CurrentForward);
  }

  public void ApplyCameraForward(Vector3 cameraForward)
  {
    transform.forward = cameraForward;
  }
}
