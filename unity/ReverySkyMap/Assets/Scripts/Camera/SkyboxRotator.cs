using UnityEngine;

public class SkyboxRotator : MonoBehaviour
{
  [SerializeField] private float minSpeed = 0.1f;
  [SerializeField] private float maxSpeed = 5f;

  private float speed;

  private void Start()
  {
    SetMinSpeed();
  }

  void Update()
  {
    RenderSettings.skybox.SetFloat("_Rotation", Time.time * speed);
  }

  private void SetMinSpeed() => speed = minSpeed;
  private void SetMaxSpeed() => speed = maxSpeed;
}
