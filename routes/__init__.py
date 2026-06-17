from routes.auth import auth
from routes.dashboard import dashboard
from routes.players import players
from routes.accounts import accounts
from routes.export import export
from routes.admin import admin
from routes.fleet import fleet
from routes.objects import game_objects
from routes.tasks import tasks
from routes.questionnaires import questionnaires
from routes.alliance import alliance
from routes.center import center
from routes.myaccounts import myaccounts
from routes.map import map_bp


def register_blueprints(app):
    app.register_blueprint(auth)
    app.register_blueprint(dashboard)
    app.register_blueprint(players)
    app.register_blueprint(accounts)
    app.register_blueprint(export)
    app.register_blueprint(admin)
    app.register_blueprint(fleet)
    app.register_blueprint(game_objects)
    app.register_blueprint(tasks)
    app.register_blueprint(questionnaires)
    app.register_blueprint(alliance)
    app.register_blueprint(center)
    app.register_blueprint(myaccounts)
    app.register_blueprint(map_bp)
