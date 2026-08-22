public enum ScapeView
{
  Undefined = 0,
  Planets = 1,
  Plain = 2,
  Buildings = 3,
}

public static class ScapeViewHelper
{
  public static ScapeView CycleView(ScapeView current)
  {
    return current switch
    {
      ScapeView.Undefined => ScapeView.Planets,
      ScapeView.Planets => ScapeView.Plain,
      ScapeView.Plain => ScapeView.Buildings,
      ScapeView.Buildings => ScapeView.Planets,
      _ => ScapeView.Planets
    };
  }
}
