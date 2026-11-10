import sys
from django.conf import settings
from django.urls import path
from django.http import HttpResponse
from django.core.exceptions import PermissionDenied
settings.configure(DEBUG=False, ALLOWED_HOSTS=["*"], ROOT_URLCONF=__name__, SECRET_KEY="lab",
                   MIDDLEWARE=["django.middleware.common.CommonMiddleware"])
def boom(r): raise RuntimeError("boom")
def forbidden(r): raise PermissionDenied
urlpatterns = [path("boom", boom), path("forbidden", forbidden)]
if __name__ == "__main__":
    from django.core.management import execute_from_command_line
    execute_from_command_line([sys.argv[0], "runserver", "0.0.0.0:80", "--noreload"])
