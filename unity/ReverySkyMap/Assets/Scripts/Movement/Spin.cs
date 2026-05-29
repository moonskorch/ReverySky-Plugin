using UnityEngine;

/// <summary>
/// Spin on Y axis automatic movement
/// </summary>
public class Spin : MonoBehaviour
{
  [SerializeField] float rotationSpeed = 20f;

  private void Update()
  {
    transform.Rotate(0f, rotationSpeed * Time.deltaTime, 0f);
  }
}
