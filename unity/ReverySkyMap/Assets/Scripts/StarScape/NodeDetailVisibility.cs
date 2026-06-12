using UnityEngine;

public class NodeDetailVisibility : MonoBehaviour
{
  [SerializeField] private Spin spin;
  [SerializeField] private LookAtCamera lookAtCamera;

  private void OnBecameVisible()
  {
    SetDetailComponentsEnabled(true);
  }

  private void OnBecameInvisible()
  {
    SetDetailComponentsEnabled(false);
  }

  private void SetDetailComponentsEnabled(bool enabled)
  {
    if (spin != null)
      spin.enabled = enabled;

    if (lookAtCamera != null)
      lookAtCamera.enabled = enabled;
  }
}
