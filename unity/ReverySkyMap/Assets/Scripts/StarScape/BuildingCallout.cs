using TMPro;
using UnityEngine;

public class BuildingCallout : MonoBehaviour
{
  private const int AzimuthSalt = 101;
  private const int ElevationSalt = 211;
  private const int SignSalt = 307;

  [SerializeField] private LineRenderer lineRenderer;
  [SerializeField] private Transform contentRoot;
  [SerializeField] private Transform buildingMarker;
  [SerializeField] private TextMeshPro nameText;
  [SerializeField] private LabelPresenter labelPresenter;
  [SerializeField] private Vector2 elevationAngleDegRange = new Vector2(15f, 90f);
  [SerializeField] private float offset = 0.6f;

  public void Init(BuildingData building, float sphereRadius)
  {
    var dir = ResolveDirection(building.Name, elevationAngleDegRange);

    var startLocal = dir * sphereRadius;
    var endLocal = dir * (sphereRadius + offset);

    buildingMarker.localPosition = startLocal;

    lineRenderer.positionCount = 2;
    lineRenderer.SetPosition(0, startLocal);  // from the star's surface
    lineRenderer.SetPosition(1, endLocal);    // towards the content

    contentRoot.localPosition = endLocal;     // name at the end of the line

    nameText.text = $"<u>{building.Name}</u>";
  }

  private static Vector3 ResolveDirection(string buildingName, Vector2 elevationRange)
  {
    string layoutKey = StableTextHash.NormalizeCaseInsensitiveKey(buildingName);
    float azimuthRad = StableTextHash.Hash01(layoutKey, AzimuthSalt) * Mathf.PI * 2f;
    float elevationDeg = Mathf.Lerp(elevationRange.x, elevationRange.y, StableTextHash.Hash01(layoutKey, ElevationSalt));
    float sign = StableTextHash.Hash01(layoutKey, SignSalt) < 0.5f ? -1f : 1f;
    float elevationRad = elevationDeg * Mathf.Deg2Rad * sign;

    return new Vector3(
      Mathf.Cos(azimuthRad) * Mathf.Cos(elevationRad),
      Mathf.Sin(elevationRad),
      Mathf.Sin(azimuthRad) * Mathf.Cos(elevationRad)
    ).normalized;
  }

  public void SetLabel(bool visible)
  {
    labelPresenter.SetModeAllowed(visible);
  }
}
