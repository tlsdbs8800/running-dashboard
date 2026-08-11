"""
Garmin OAuth 로그인 (브라우저 불필요).
토큰은 sessions/garth-{user}/ 에 저장됩니다 (~30일 유효).

Usage:
  python3 garth-login.py           → 윤호
  python3 garth-login.py --user gf → Jenny
"""

import getpass
import sys
from pathlib import Path

import garth

args = sys.argv[1:]
user_id = "gf" if "--user" in args and args[args.index("--user") + 1] == "gf" else "yunho"
name = "Jenny" if user_id == "gf" else "윤호"
save_dir = Path(__file__).parent / f"sessions/garth-{user_id}"

print(f"\n[{name}] Garmin OAuth 로그인")
print("─" * 40)
email = input("가민 이메일: ")
password = getpass.getpass("비밀번호: ")

garth.login(email, password)
garth.save(str(save_dir))

print(f"✅ 저장 완료: {save_dir}")
print("   refresh token 유효기간: ~30일")
print("   30일 후 이 스크립트 다시 실행하세요.\n")
