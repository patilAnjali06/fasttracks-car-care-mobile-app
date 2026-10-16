# InvocationTargetException tracking

Recurring native error seen during Attendance manager-surface testing on
2026-09-26, emulator `fasttracks_test`, dev-client build (expo-dev-client).

Stack (repeats identically each time):
```
java.lang.reflect.InvocationTargetException
  at java.lang.reflect.Constructor.newInstance0
  at expo.modules.kotlin.views.ViewDefinitionBuilder.createViewFactory$lambda$28
  at expo.modules.kotlin.views.ViewManagerDefinition.createView
  at com.facebook.react.fabric.mounting.SurfaceMountingManager.preallocateView
  at com.facebook.react.fabric.mounting.mountitems.PreAllocateViewMountItem.execute
```
Native view-preallocation failure inside Expo Modules Core / Fabric — not a JS-level
exception in our own AdminAttendance code. Not chasing this now per instruction;
logging occurrences only. If it recurs on other screens, treat as a real defect.

## Occurrences

- **2026-09-26**, screen: Attendance → All Employees (manager surface), while
  navigating/scrolling the "Today's Attendance" list and testing the Override
  button on the "Chinna" row. Appeared as a repeating toast, briefly seemed to
  block a tap on the row. Cleared after a full app restart (force-stop +
  relaunch); did not reappear afterward in the same testing session (through
  the rest of Attendance verification on 2026-09-27).
