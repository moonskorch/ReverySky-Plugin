using System;
using UnityEngine;
using UnityEngine.UI;

public class ChangeViewControl : MonoBehaviour
{
  [SerializeField] private Button changeViewButton;

  public event Action OnChangeScapeView;

  void Start()
  {
    if (changeViewButton == null)
      changeViewButton = GetComponent<Button>();

    if (changeViewButton == null)
    {
      Debug.LogWarning("[ChangeViewControl] changeViewButton is not assigned.");
      return;
    }

    changeViewButton.onClick.AddListener(() =>
    {
      OnChangeScapeView?.Invoke();
    });
  }
}
