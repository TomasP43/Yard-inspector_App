use strict;
use warnings;
use IO::Socket::INET;

# Servidor estatico minimo, solo para mirar el front en el navegador.
my ($root, $port) = @ARGV;
$port ||= 4173;

my %TIPO = (
  html => 'text/html; charset=utf-8',
  css  => 'text/css; charset=utf-8',
  js   => 'application/javascript; charset=utf-8',
  json => 'application/json; charset=utf-8',
  svg  => 'image/svg+xml',
  png  => 'image/png',
  jpg  => 'image/jpeg'
);

my $srv = IO::Socket::INET->new(
  LocalAddr => '127.0.0.1',
  LocalPort => $port,
  Proto     => 'tcp',
  Listen    => 16,
  ReuseAddr => 1
) or die "no escucha en $port: $!";

print "sirviendo $root en http://127.0.0.1:$port/\n";

while (my $c = $srv->accept) {
  my $req = <$c>;
  next unless $req;
  while (my $l = <$c>) { last if $l =~ /^\r?\n$/ }

  my ($path) = $req =~ m{^GET\s+(\S+)};
  $path = '/' unless defined $path;
  $path =~ s/\?.*$//;
  $path =~ s/%20/ /g;
  $path = '/index.html' if $path eq '/';
  $path =~ s{\.\.}{}g;

  my $file = $root . $path;
  if (-f $file) {
    my ($ext) = $file =~ /\.([a-z0-9]+)$/i;
    my $tipo = $TIPO{ lc($ext || '') } || 'application/octet-stream';
    open(my $fh, '<:raw', $file);
    local $/;
    my $body = <$fh>;
    close $fh;
    print $c "HTTP/1.0 200 OK\r\nContent-Type: $tipo\r\nContent-Length: " . length($body)
      . "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
    print $c $body;
  } else {
    print $c "HTTP/1.0 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
  }
  close $c;
}
