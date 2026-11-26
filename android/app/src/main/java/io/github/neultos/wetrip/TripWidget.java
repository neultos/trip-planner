package io.github.neultos.wetrip;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import java.time.LocalDate;

/** 홈 화면 위젯: 여행 이름 · 날짜 · D-day, 누르면 그 여행 일정이 바로 열림 */
public final class TripWidget extends AppWidgetProvider {
    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) { for (int id : ids) draw(c, m, id); }

    @Override public void onDeleted(Context c, int[] ids) {
        android.content.SharedPreferences.Editor e = TripStore.prefs(c).edit();
        for (int id : ids) e.remove("w" + id);
        e.apply();
    }

    static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        for (int id : m.getAppWidgetIds(new ComponentName(c, TripWidget.class))) draw(c, m, id);
    }

    static void draw(Context c, AppWidgetManager m, int wid) {
        LocalDate today = LocalDate.now();
        TripStore.Trip t = TripStore.pick(c, TripStore.prefs(c).getString("w" + wid, TripStore.AUTO), today);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_trip);
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (t != null) {
            v.setTextViewText(R.id.w_title, t.title);
            v.setTextViewText(R.id.w_sub, TripStore.dates(t));
            v.setTextViewText(R.id.w_badge, TripStore.badge(t, today));
            v.setViewVisibility(R.id.w_badge, View.VISIBLE);
            open.putExtra("trip", t.id);
        } else {
            v.setTextViewText(R.id.w_title, "위트립");
            v.setTextViewText(R.id.w_sub, "앱을 열어 여행을 불러와 주세요");
            v.setViewVisibility(R.id.w_badge, View.GONE);
        }
        // 위젯마다 다른 요청 코드를 써야 서로의 여행 id가 덮어쓰이지 않음
        v.setOnClickPendingIntent(R.id.w_root, PendingIntent.getActivity(c, wid, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        m.updateAppWidget(wid, v);
    }
}
