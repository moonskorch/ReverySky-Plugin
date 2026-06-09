using System;
using UnityEngine;

public class Star : MonoBehaviour
{
  [SerializeField] private StarSO starSO;

  /// <summary>
  /// Link to runtime note data.
  /// </summary>
  public NoteData Data { get; private set; } = new NoteData();

  public event Action OnDataChanged;

  public void SetData(NoteData data)
  {
    Data = data;
    OnDataChanged?.Invoke();
  }

  public void SetView(ScapeView view) 
  {
    Data.ScapeView = view;
    OnDataChanged?.Invoke();
  }
}
