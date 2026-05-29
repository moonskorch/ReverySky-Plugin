using System;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class OptionsForm : MonoBehaviour
{
  [SerializeField] private Button showWeekButton;
  [SerializeField] private Button showMonthButton;
  [SerializeField] private Button showYearButton;
  [SerializeField] private Button showAllButton;

  [SerializeField] private TMP_Dropdown importanceDropdown;
  [SerializeField] private TMP_Dropdown engineDropdown;
  [SerializeField] private TextMeshProUGUI engineComment;

  public event Action<int, CrystalType, CartographerEngine> OnFilterApplied;


  private void Start()
  {
    if (importanceDropdown == null || engineDropdown == null)
    {
      Debug.LogWarning("[OptionsForm] Required dropdown references are missing.");
      return;
    }

    var importanceSaved = MapRuntimeContext.FilterImportance;
    importanceDropdown.SetValueWithoutNotify((int)importanceSaved);

    var engineSaved = MapRuntimeContext.FilterEngine;
    engineDropdown.SetValueWithoutNotify((int)engineSaved);

    UpdateEngineComment(engineDropdown.value);

    if (showWeekButton != null) showWeekButton.onClick.AddListener(() =>
    {
      ApplyFilter(
        7 - 1, 
        (CrystalType)importanceDropdown.value, 
        (CartographerEngine)engineDropdown.value);
    });
    if (showMonthButton != null) showMonthButton.onClick.AddListener(() =>
    {
      ApplyFilter(
        30 - 1, 
        (CrystalType)importanceDropdown.value, 
        (CartographerEngine)engineDropdown.value);
    });
    if (showYearButton != null) showYearButton.onClick.AddListener(() =>
    {
      ApplyFilter(
        365 - 1, 
        (CrystalType)importanceDropdown.value, 
        (CartographerEngine)engineDropdown.value);
    });
    if (showAllButton != null) showAllButton.onClick.AddListener(() =>
    {
      ApplyFilter(
        0, 
        (CrystalType)importanceDropdown.value, 
        (CartographerEngine)engineDropdown.value);
    });
    engineDropdown.onValueChanged.AddListener(val =>
    {
      UpdateEngineComment(val);
    });
  }

  private void UpdateEngineComment(int engineDropdownValue) 
  {
    if (engineComment == null)
      return;

    var isEngineForce = engineDropdownValue == (int)CartographerEngine.Forces;
    if (isEngineForce)
    {
      engineComment.text = GameSettings.ScapeFilterEngineThresholdComment;
    }
    engineComment.gameObject.SetActive(isEngineForce);
  }

  private void ApplyFilter(int fromDaysAgo, CrystalType importance, CartographerEngine engine) 
  {
    MapRuntimeContext.FilterRangeDays = fromDaysAgo;
    MapRuntimeContext.FilterImportance = importance;
    MapRuntimeContext.FilterEngine = engine;
    OnFilterApplied?.Invoke(fromDaysAgo, importance, engine);
    gameObject.SetActive(false);
  }

}
