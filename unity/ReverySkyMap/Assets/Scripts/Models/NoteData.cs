using System;
using System.Collections.Generic;

/// <summary>
/// Note data used to configure map appearance and properties at runtime
/// </summary>
[Serializable]
public class NoteData 
{
  public string Id { get; set; } = string.Empty;
  public string Name { get; set; } = string.Empty;
  public string Path {  get; set; } = null;
  public DateTime DateTime { get; set; } = DateTime.MinValue;
  public int Length { get; set; } = 0;
  public int DirectLinkCount { get; set; } = 0;
  public CrystalType CrystalType { get; set; } = CrystalType.Unknown;
  public SphereType SphereType { get; set; } = SphereType.Unknown;
  public List<int> TagIds { get; set; } = new();

  public ScapeView ScapeView { get; set; } = ScapeView.Planets;
}
