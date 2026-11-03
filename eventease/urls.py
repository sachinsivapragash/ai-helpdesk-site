from django.urls import include, path

urlpatterns = [path('', include('helpdesk.urls'))]

handler404 = 'helpdesk.views.not_found'
handler500 = 'helpdesk.views.server_error'
