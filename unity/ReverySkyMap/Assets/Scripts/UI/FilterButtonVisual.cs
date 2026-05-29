using UnityEngine;
using UnityEngine.UI;

public class FilterButtonVisual : MonoBehaviour
{
  [SerializeField] private OptionsForm optionsForm;
  [SerializeField] private Image targetImage;
  [SerializeField] private Color inactiveColor = Color.white;
  [SerializeField] private Color activeColor = new Color32(128, 128, 128, 255); // #808080

  private void Start() 
  {
    var range = MapRuntimeContext.FilterRangeDays;
    var importance = MapRuntimeContext.FilterImportance;
    var engine = MapRuntimeContext.FilterEngine;
    UpdateVisual(range, importance, engine);

    if (optionsForm != null)
      optionsForm.OnFilterApplied += UpdateVisual;
  }

  private void OnDestroy()
  {
    if (optionsForm != null)
      optionsForm.OnFilterApplied -= UpdateVisual;
  }

  public void UpdateVisual(int fromDaysAgo, CrystalType importance, CartographerEngine engine)
  {
    if (!targetImage)
      return;

    var isActive = fromDaysAgo != 0 || importance != CrystalType.Unknown;

    targetImage.color = isActive ? activeColor : inactiveColor;
  }
}
