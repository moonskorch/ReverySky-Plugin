using UnityEngine;

/// <summary>
/// Float automatic movement
/// </summary>
public class Float : MonoBehaviour
{
  [SerializeField] float amplitude = 0.1f;
  [SerializeField] float frequency = 1.2f;

  private float baseY;

  private void Start()
  {
    baseY = transform.position.y;
  }

  private void Update()
  {
    var p = transform.position;
    p.y = baseY + Mathf.Sin(Time.time * frequency) * amplitude;
    transform.position = p;
  }
}
