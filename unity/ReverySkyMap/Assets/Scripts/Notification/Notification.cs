using TMPro;
using UnityEngine;

public class Notification : MonoBehaviour
{
  [SerializeField] private GameObject go;
  [SerializeField] private TextMeshPro caption;
  [SerializeField] private Behaviour[] relatedBehaviours;

  public void UpdateNoticeMessage(bool isShown, string text)
  {
    caption.text = text;
    SetRelatedBehavioursVisible(isShown);
    go.SetActive(isShown);
  }

  private void SetRelatedBehavioursVisible(bool visible)
  {
    if (relatedBehaviours == null)
      return;

    for (int i = 0; i < relatedBehaviours.Length; i++)
    {
      Behaviour behaviour = relatedBehaviours[i];
      if (behaviour != null && behaviour.enabled != visible)
        behaviour.enabled = visible;
    }
  }
}
