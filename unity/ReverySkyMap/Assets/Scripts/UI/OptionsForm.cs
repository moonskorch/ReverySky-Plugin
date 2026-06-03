using TMPro;
using UnityEngine;

public class OptionsForm : MonoBehaviour
{
  [SerializeField] private TMP_Dropdown engineDropdown;
  [SerializeField] private TextMeshProUGUI engineComment;

  private void Start()
  {
    if (engineDropdown == null)
    {
      Debug.LogWarning("[OptionsForm] Engine dropdown reference is missing.");
      return;
    }

    engineDropdown.SetValueWithoutNotify((int)MapRuntimeContext.EnginePreference);
    if (engineComment != null)
      engineComment.gameObject.SetActive(false);

    enabled = false;
  }
}
