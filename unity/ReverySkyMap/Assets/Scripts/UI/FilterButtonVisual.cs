using UnityEngine;
using UnityEngine.UI;

public class FilterButtonVisual : MonoBehaviour
{
  [SerializeField] private Image targetImage;
  [SerializeField] private Color inactiveColor = Color.white;

  private void Start()
  {
    if (targetImage != null)
      targetImage.color = inactiveColor;

    enabled = false;
  }
}
