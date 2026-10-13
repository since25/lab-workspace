-- 005_freezer_view_all.sql：「冰箱总览」附加权限——普通成员开启后可只读查看全部人员的冰箱内容
-- 默认关闭，现有账号权限不变；管理员本身即可查看全部，无需开启
ALTER TABLE users ADD COLUMN freezer_view_all boolean NOT NULL DEFAULT false;
