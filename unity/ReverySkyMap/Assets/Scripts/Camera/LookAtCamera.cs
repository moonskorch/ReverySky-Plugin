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
  private void OnEnable()
  {
    CameraForwardWatcher.I.Register(this);
  }

  private void OnDisable()
  {
    CameraForwardWatcher.I.Unregister(this);
  }

  public void ApplyCameraForward(Vector3 cameraForward)
  {
    transform.forward = cameraForward;
  }
}
