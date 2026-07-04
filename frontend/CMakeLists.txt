# Web console. Built via npm + Vite, not CMake's own toolchain - wrapped as
# a custom target whose output (dist/) the detector backend will eventually
# serve as static files. Re-runs npm ci/build whenever package.json,
# package-lock.json, or source files under src/ change.

find_program(NPM_EXECUTABLE npm REQUIRED)

set(FRONTEND_DIR ${CMAKE_CURRENT_SOURCE_DIR})
set(FRONTEND_DIST ${FRONTEND_DIR}/dist)

file(GLOB_RECURSE FRONTEND_SOURCES ${FRONTEND_DIR}/src/*)

add_custom_command(
  OUTPUT ${FRONTEND_DIST}/index.html
  COMMAND ${NPM_EXECUTABLE} ci
  COMMAND ${NPM_EXECUTABLE} run build
  WORKING_DIRECTORY ${FRONTEND_DIR}
  DEPENDS ${FRONTEND_DIR}/package.json ${FRONTEND_DIR}/package-lock.json ${FRONTEND_SOURCES}
  COMMENT "Building frontend (npm ci && npm run build)"
  VERBATIM
)
add_custom_target(frontend_build ALL DEPENDS ${FRONTEND_DIST}/index.html)
