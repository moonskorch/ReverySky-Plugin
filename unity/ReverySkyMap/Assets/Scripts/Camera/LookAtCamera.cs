using UnityEngine;

public class LookAtCamera : MonoBehaviour
{
  private enum Mode
  {
    LookAt,
    LookAtInverted,
    CameraForward,
    CameraForwardInverted
  }

  [SerializeField] private Mode mode;
  private Transform cameraTransform;

  private void Start()
  {
    cameraTransform = Camera.main.transform;
  }

  private void LateUpdate()
  {
    switch (mode)
    {
      case Mode.LookAt:
        transform.LookAt(cameraTransform);
        break;
      case Mode.LookAtInverted:
        Vector3 dirFromCamera = transform.position - cameraTransform.position;
        transform.LookAt(transform.position + dirFromCamera);
        break;
      case Mode.CameraForwardInverted:
        transform.forward = -cameraTransform.forward;
        break;
      case Mode.CameraForward:
      default:
        transform.forward = cameraTransform.forward;
        break;
    }
  }
}
