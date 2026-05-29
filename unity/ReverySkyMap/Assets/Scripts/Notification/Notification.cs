using TMPro;
using UnityEngine;

public class Notification : MonoBehaviour
{
  [SerializeField] private GameObject go;
  [SerializeField] private TextMeshPro caption;

  public void UpdateNoticeMessage(bool isShown, string text)
  {
    caption.text = text;
    go.SetActive(isShown);
  }
}
