using TMPro;
using UnityEngine;

public class BuildingCallout : MonoBehaviour
{
  private const int SlotSalt = 101;
  private const float GoldenAngleRad = 2.3999631f;

  [SerializeField] private LineRenderer lineRenderer;
  [SerializeField] private Transform contentRoot;
  [SerializeField] private Transform buildingMarker;
  [SerializeField] private TextMeshPro nameText;
  [SerializeField] private LabelPresenter labelPresenter;
  [SerializeField] private Vector2 elevationAngleDegRange = new Vector2(15f, 90f);
  [SerializeField, Range(1, 64)] private int directionSlotCount = 16;
  [SerializeField] private float offset = 0.6f;

  public int DirectionSlotCount => directionSlotCount;

  public void Init(BuildingData building, float sphereRadius, int slotIndex)
  {
    var dir = ResolveSlotDirection(slotIndex, DirectionSlotCount, elevationAngleDegRange);

    var startLocal = dir * sphereRadius;
    var endLocal = dir * (sphereRadius + offset);

    buildingMarker.localPosition = startLocal;

    lineRenderer.positionCount = 2;
    lineRenderer.SetPosition(0, startLocal);  // from the star's surface
    lineRenderer.SetPosition(1, endLocal);    // towards the content

    contentRoot.localPosition = endLocal;     // name at the end of the line

    nameText.text = $"<u>{building.Name}</u>";
  }

  private static Vector3 ResolveDirection(string buildingName, Vector2 elevationRange, int slotCount)
  {
    string layoutKey = StableTextHash.NormalizeCaseInsensitiveKey(buildingName);
    int resolvedSlotCount = Mathf.Max(1, slotCount);
    int slotIndex = ResolveSlotFromLayoutKey(layoutKey, resolvedSlotCount);
    return ResolveSlotDirection(slotIndex, resolvedSlotCount, elevationRange);
  }

  private static Vector3 ResolveSlotDirection(int slotIndex, int slotCount, Vector2 elevationRange)
  {
    int resolvedSlotCount = Mathf.Max(1, slotCount);
    int wrappedSlot = PositiveModulo(slotIndex, resolvedSlotCount);
    bool upperHemisphere = (wrappedSlot % 2) == 0;
    int hemisphereSlot = wrappedSlot / 2;
    int hemisphereSlotCount = upperHemisphere
      ? (resolvedSlotCount + 1) / 2
      : Mathf.Max(1, resolvedSlotCount / 2);

    float minElevationDeg = Mathf.Clamp(Mathf.Min(Mathf.Abs(elevationRange.x), Mathf.Abs(elevationRange.y)), 0f, 90f);
    float maxElevationDeg = Mathf.Clamp(Mathf.Max(Mathf.Abs(elevationRange.x), Mathf.Abs(elevationRange.y)), minElevationDeg, 90f);
    float bandT = (hemisphereSlot + 0.5f) / hemisphereSlotCount;
    float yAbs = Mathf.Lerp(
      Mathf.Sin(minElevationDeg * Mathf.Deg2Rad),
      Mathf.Sin(maxElevationDeg * Mathf.Deg2Rad),
      bandT);

    float y = upperHemisphere ? yAbs : -yAbs;
    float xzRadius = Mathf.Sqrt(Mathf.Max(0f, 1f - y * y));
    float azimuthRad = wrappedSlot * GoldenAngleRad;

    return new Vector3(
      Mathf.Cos(azimuthRad) * xzRadius,
      y,
      Mathf.Sin(azimuthRad) * xzRadius
    ).normalized;
  }

  public static int ResolvePreferredSlot(string buildingName, int slotCount)
  {
    string layoutKey = StableTextHash.NormalizeCaseInsensitiveKey(buildingName);
    return ResolveSlotFromLayoutKey(layoutKey, slotCount);
  }

  public static int ResolveAvailableSlot(int preferredSlot, bool[] occupiedSlots)
  {
    if (occupiedSlots == null || occupiedSlots.Length == 0)
      return 0;

    int slotCount = occupiedSlots.Length;
    int wrappedPreferredSlot = PositiveModulo(preferredSlot, slotCount);
    if (!occupiedSlots[wrappedPreferredSlot])
      return wrappedPreferredSlot;

    for (int i = 1; i < slotCount; i++)
    {
      int candidate = PositiveModulo(wrappedPreferredSlot + i, slotCount);
      if (!occupiedSlots[candidate])
        return candidate;
    }

    return wrappedPreferredSlot;
  }

  private static int ResolveSlotFromLayoutKey(string layoutKey, int slotCount)
    => StableTextHash.Index(layoutKey, SlotSalt, slotCount);

  private static int PositiveModulo(int value, int modulo)
    => ((value % modulo) + modulo) % modulo;

  public void SetLabel(bool visible)
  {
    labelPresenter.SetModeAllowed(visible);
  }
}
