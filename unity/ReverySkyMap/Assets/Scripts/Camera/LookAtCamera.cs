using UnityEngine;

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
