// The dashboard this app mirrors has no dark theme, and the app itself has
// no in-app theme toggle — so following the OS's system scheme means it
// silently goes dark on any device with system dark mode on, which isn't a
// deliberate choice by anyone. Force light so the shipped app matches the
// dashboard's actual look by default.
export function useColorScheme(): 'light' | 'dark' {
  return 'light';
}
