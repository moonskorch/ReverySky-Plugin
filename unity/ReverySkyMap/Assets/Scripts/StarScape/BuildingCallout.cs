using TMPro;
using UnityEngine;

public class BuildingCallout : MonoBehaviour
{
  [SerializeField] private LineRenderer lineRenderer;
  [SerializeField] private Transform contentRoot;
  [SerializeField] private Transform buildingMarker;
  [SerializeField] private TextMeshPro nameText;
  [SerializeField] private LabelPresenter labelPresenter;
  [SerializeField] private Vector2 elevationAngleDegRange = new Vector2(15f, 90f);
  [SerializeField] private float offset = 0.6f;

  public void Init(BuildingData building, float sphereRadius, float angleRad)
  {
    // random vertical elevation
    float elevationDeg = Rng.Range(
      elevationAngleDegRange.x,
      elevationAngleDegRange.y);

    // up or down
    float sign = Rng.Coin() ? -1f : 1f;
    float elevationRad = elevationDeg * Mathf.Deg2Rad * sign;

    // line direction with angle and elevation
    var dir = new Vector3(
      Mathf.Cos(angleRad) * Mathf.Cos(elevationRad),
      Mathf.Sin(elevationRad),
      Mathf.Sin(angleRad) * Mathf.Cos(elevationRad)
    ).normalized;

    var startLocal = dir * sphereRadius;
    var endLocal = dir * (sphereRadius + offset);

    buildingMarker.localPosition = startLocal;

    lineRenderer.positionCount = 2;
    lineRenderer.SetPosition(0, startLocal);  // from the star's surface
    lineRenderer.SetPosition(1, endLocal);    // towards the content

    contentRoot.localPosition = endLocal;     // name at the end of the line

    nameText.text = $"<u>{building.Name}</u>";
  }

  public void SetLabel(bool visible)
  {
    labelPresenter.SetModeAllowed(visible);
  }
}
