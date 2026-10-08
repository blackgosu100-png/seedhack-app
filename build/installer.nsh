; 업데이트·재설치 때 "cannot be closed" 창 방지:
; 기본 '실행 중이면 닫기 시도 → 실패 창' 대신, 소싱 신호등 프로세스를 강제로 끝내고 잠깐 기다린 뒤 진행한다.
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /T /IM "CoupangSignal.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM "쿠팡 소싱 신호등.exe"'
  Pop $0
  Sleep 1500
!macroend

; 옛 버전 제거 프로그램이 실패해도(예: "Failed to uninstall old application files: 2") 설치를 멈추지 않는다.
; 옛 버전 제거기는 이 수정 전에 설치된 것이라 고칠 수 없고, 새 파일로 그대로 덮어쓰면 되므로 계속 진행한다.
!macro customUnInstallCheck
  ClearErrors
!macroend
!macro customUnInstallCheckCurrentUser
  ClearErrors
!macroend

; 설치 시작 때: 소싱 신호등을 끄고, 옛 버전 제거 정보를 지워 옛 제거 프로그램이 실행되지 않게 한다.
; (옛 버전(0.5.5 이하)의 제거 프로그램은 앱이 꺼져 있어도 "cannot be closed"로 멈출 수 있음 — 새 버전이 파일을 덮어쓰고 제거 정보를 다시 기록한다)
!macro customInit
  nsExec::Exec 'taskkill /F /T /IM "CoupangSignal.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM "쿠팡 소싱 신호등.exe"'
  Pop $0
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY_2}"
  !endif
!macroend

; 설치가 끝나면 옛 한글 이름 실행 파일(0.5.1 이하)을 지운다
!macro customInstall
  Delete "$INSTDIR\쿠팡 소싱 신호등.exe"
!macroend
